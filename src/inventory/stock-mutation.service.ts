import { OperationalWriteGateService } from '../operation-control/operational-write-gate.service.js';
import {
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Prisma, type UserRole } from '../generated/prisma/client.js';
import { SessionService } from '../auth/session.service.js';
import type { AuthenticationContext } from '../auth/authenticated-user.js';
import { PrismaService } from '../database/prisma.service.js';

@Injectable()
export class StockMutationService {
  constructor(
    @Inject(OperationalWriteGateService)
    private readonly gate: OperationalWriteGateService,
    @Inject(PrismaService) private readonly database: PrismaService,
    @Inject(SessionService) private readonly sessions: SessionService,
  ) {}

  async run<T>(
    context: AuthenticationContext,
    operation:
      | 'placement_transfer'
      | 'custody_transfer'
      | 'receipt'
      | 'adjustment'
      | 'shipment_register'
      | 'shipment_prepare'
      | 'shipment_dispatch'
      | 'return_receive'
      | 'return_inspect'
      | 'return_review',
    key: string,
    roles: readonly UserRole[],
    work: (
      transaction: Prisma.TransactionClient,
      current: AuthenticationContext,
    ) => Promise<T>,
  ): Promise<T> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await this.database.$transaction(
          async (transaction) => {
            await this.gate.enter(transaction);
            // The stable warehouse code is part of the lock identity; key reuse
            // across receipts and adjustments must remain independent.
            await transaction.$executeRaw`SELECT pg_advisory_xact_lock(847313, hashtext(${`${operation}:MAIN:${key}`}))`;
            await this.sessions.lockUser(transaction, context.user.id);
            const current = await this.sessions.validate(
              transaction,
              context.sessionId,
              context.user.id,
            );
            this.requireWriter(current, roles);
            return work(transaction, current);
          },
          { isolationLevel: 'ReadCommitted', timeout: 15000 },
        );
      } catch (error) {
        if (attempt < 2 && this.isRetryableTransactionConflict(error)) continue;
        throw error;
      }
    }
    throw new UnauthorizedException('Request could not be completed');
  }

  async revalidate(
    transaction: Prisma.TransactionClient,
    context: AuthenticationContext,
    roles: readonly UserRole[],
  ): Promise<AuthenticationContext> {
    const current = await this.sessions.validate(
      transaction,
      context.sessionId,
      context.user.id,
    );
    this.requireWriter(current, roles);
    return current;
  }

  private requireWriter(
    context: AuthenticationContext,
    roles: readonly UserRole[],
  ): void {
    if (context.user.mustChangePassword || !roles.includes(context.user.role))
      throw new ForbiddenException('Warehouse access required');
  }

  private isRetryableTransactionConflict(error: unknown): boolean {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2034') return true;
      if (error.code !== 'P2010') return false;
      const meta = error.meta as
        | {
            code?: unknown;
            driverAdapterError?: { cause?: { originalCode?: unknown } };
          }
        | undefined;
      const state = meta?.code ?? meta?.driverAdapterError?.cause?.originalCode;
      return state === '40001' || state === '40P01';
    }
    return false;
  }
}
