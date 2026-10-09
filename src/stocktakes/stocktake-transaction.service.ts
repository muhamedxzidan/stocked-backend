import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  Prisma,
  Stocktake,
  UserRole,
} from '../generated/prisma/client.js';
import { PrismaService } from '../database/prisma.service.js';
import { SessionService } from '../auth/session.service.js';
import type { AuthenticationContext } from '../auth/authenticated-user.js';
import { OperationalWriteGateService } from '../operation-control/operational-write-gate.service.js';
import {
  requireIdempotencyKey,
  requestHash,
} from '../operation-control/request-identity.js';
export interface StocktakeCommandResult {
  stocktakeId: string;
  details: Prisma.InputJsonObject;
}
@Injectable()
export class StocktakeTransactionService {
  constructor(
    @Inject(PrismaService) private readonly database: PrismaService,
    @Inject(SessionService) private readonly sessions: SessionService,
    @Inject(OperationalWriteGateService)
    private readonly gate: OperationalWriteGateService,
  ) {}
  async run(
    context: AuthenticationContext,
    key: string | undefined,
    kind: string,
    payload: object,
    exclusive: boolean,
    roles: readonly UserRole[],
    work: (
      tx: Prisma.TransactionClient,
      current: AuthenticationContext,
      recordedAt: Date,
    ) => Promise<StocktakeCommandResult>,
  ) {
    const idempotencyKey = requireIdempotencyKey(key),
      hash = requestHash({ kind, payload });
    return this.database.$transaction(
      async (tx) => {
        if (exclusive) await this.gate.exclusive(tx);
        else await this.gate.shared(tx);
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(847315,hashtext(${idempotencyKey}))`;
        await this.sessions.lockUser(tx, context.user.id);
        const current = await this.sessions.validate(
          tx,
          context.sessionId,
          context.user.id,
        );
        if (
          current.user.mustChangePassword ||
          !roles.includes(current.user.role)
        )
          throw new ForbiddenException('Stocktake access denied');
        const previous = await tx.stocktakeEvent.findUnique({
          where: { idempotencyKey },
        });
        if (previous) {
          if (
            previous.actorId !== current.user.id ||
            previous.kind !== kind ||
            previous.requestHash !== hash
          )
            throw new ConflictException('Idempotency key is already used');
          return { replayed: true, event: previous };
        }
        const recordedAt = await this.database.time(tx);
        const result = await work(tx, current, recordedAt);
        // Recheck authorization after all potentially blocking business locks.
        const verified = await this.sessions.validate(
          tx,
          current.sessionId,
          current.user.id,
        );
        if (
          verified.user.mustChangePassword ||
          !roles.includes(verified.user.role)
        )
          throw new ForbiddenException('Stocktake access denied');
        const sequence =
          ((
            await tx.stocktakeEvent.aggregate({
              where: { stocktakeId: result.stocktakeId },
              _max: { sequence: true },
            })
          )._max.sequence ?? 0) + 1;
        const event = await tx.stocktakeEvent.create({
          data: {
            sequence,
            stocktakeId: result.stocktakeId,
            kind,
            details: result.details,
            actorId: verified.user.id,
            actorNameSnapshot: verified.user.displayName,
            recordedAt: await this.database.time(tx),
            idempotencyKey,
            requestHash: hash,
          },
        });
        return { replayed: false, event };
      },
      { isolationLevel: 'ReadCommitted', timeout: 60000 },
    );
  }
  async lockCycle(
    tx: Prisma.TransactionClient,
    id: string,
    states: readonly Stocktake['status'][],
  ): Promise<Stocktake> {
    await tx.$queryRaw`SELECT id FROM stocktakes WHERE id=${id}::uuid FOR UPDATE`;
    const cycle = await tx.stocktake.findUnique({ where: { id } });
    if (!cycle) throw new NotFoundException('Stocktake not found');
    if (!states.includes(cycle.status))
      throw new ConflictException(
        'Stocktake state does not permit this action',
      );
    return cycle;
  }
  async participants(
    tx: Prisma.TransactionClient,
    stocktakeId: string,
  ): Promise<Set<string>> {
    const events = await tx.stocktakeEvent.findMany({
      where: { stocktakeId, kind: { in: ['OPENED', 'ATTENDANCE'] } },
      orderBy: { sequence: 'asc' },
    });
    const present = new Set<string>();
    for (const event of events) {
      const d = event.details as {
        participantIds?: string[];
        userId?: string;
        present?: boolean;
      };
      if (event.kind === 'OPENED')
        for (const id of d.participantIds ?? []) present.add(id);
      else if (d.userId) {
        if (d.present) present.add(d.userId);
        else present.delete(d.userId);
      }
    }
    return present;
  }
  async requireCounter(
    tx: Prisma.TransactionClient,
    cycle: Stocktake,
    current: AuthenticationContext,
  ): Promise<void> {
    if (!(await this.participants(tx, cycle.id)).has(current.user.id))
      throw new ForbiddenException(
        'Counter must be recorded as present in this stocktake',
      );
  }
}
