import { canonicalShelfAllocations } from '../inventory/stock-placement-input.js';
import { ReturnCustodyPlacementService } from '../inventory/return-custody-placement.service.js';
import { StockPlacementService } from '../inventory/stock-placement.service.js';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
} from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import type { AuthenticationContext } from '../auth/authenticated-user.js';
import { StockMutationService } from '../inventory/stock-mutation.service.js';
import { StockPostingService } from '../inventory/stock-posting.service.js';
import type { InspectReturnDto } from './dto/inspect-return.dto.js';
import { returnHash, returnKey } from './return-request-identity.js';
import { inspectionSelect, returnWriterRoles } from './return-select.js';
import { lockReturnItems, lockReturnReceipt } from './return-source.js';

@Injectable()
export class ReturnInspectionService {
  constructor(
    @Inject(ReturnCustodyPlacementService)
    private readonly custody: ReturnCustodyPlacementService,
    @Inject(StockPlacementService)
    private readonly placements: StockPlacementService,
    @Inject(PrismaService) private readonly database: PrismaService,
    @Inject(StockMutationService)
    private readonly mutations: StockMutationService,
    @Inject(StockPostingService) private readonly posting: StockPostingService,
  ) {}
  async inspect(
    context: AuthenticationContext,
    id: string,
    key: string | undefined,
    input: InspectReturnDto,
  ) {
    const receiptId = id.toLowerCase(),
      idempotencyKey = returnKey(key);
    const canonical = {
      receiptId,
      lines: input.lines.map((l) => ({
        receiptLineId: l.receiptLineId.toLowerCase(),
        quantity: l.quantity,
        condition: l.condition,
        issueType: l.issueType ?? null,
        notes: l.notes?.trim() || null,
        placements: canonicalShelfAllocations(l.placements),
        custodySources: canonicalShelfAllocations(l.custodySources),
      })),
    };
    const classes = new Set<string>();
    for (const line of canonical.lines) {
      if (
        line.condition === 'GOOD'
          ? line.issueType !== null || line.notes !== null
          : !line.issueType || !line.notes || Array.from(line.notes).length < 10
      )
        throw new BadRequestException(
          'GOOD has no issues; NOTED requires issue and precise notes of at least 10 characters',
        );
      if (
        line.condition === 'NOTED' &&
        (line.placements || line.custodySources)
      )
        throw new BadRequestException(
          'Pending groups cannot include stock allocations',
        );
      const classification = `${line.receiptLineId}:${line.condition}:${line.issueType ?? ''}`;
      if (classes.has(classification))
        throw new BadRequestException('Duplicate inspection classification');
      classes.add(classification);
    }
    const requestHash = returnHash(canonical);
    return this.mutations.run(
      context,
      'return_inspect',
      idempotencyKey,
      returnWriterRoles,
      async (tx, current) => {
        const warehouse = await tx.warehouse.findUnique({
          where: { code: 'MAIN' },
          select: { id: true },
        });
        if (!warehouse)
          throw new ConflictException('Main warehouse is not initialized');
        const previous = await tx.returnInspection.findUnique({
          where: {
            warehouseId_idempotencyKey: {
              warehouseId: warehouse.id,
              idempotencyKey,
            },
          },
        });
        if (previous) {
          if (
            previous.inspectedById !== current.user.id ||
            previous.requestHash !== requestHash
          )
            throw new ConflictException('Idempotency key is already used');
          return {
            replayed: true,
            inspection: await tx.returnInspection.findUniqueOrThrow({
              where: { id: previous.id },
              select: inspectionSelect,
            }),
          };
        }
        const receipt = await lockReturnReceipt(tx, receiptId);
        if (
          await tx.returnInspection.findUnique({
            where: { receiptId },
            select: { id: true },
          })
        )
          throw new ConflictException('Return is already inspected');
        const groups = canonical.lines.map((l) => {
          const source = receipt.lines.find((s) => s.id === l.receiptLineId);
          if (!source)
            throw new BadRequestException(
              'Inspection line does not belong to return',
            );
          return { ...l, source };
        });
        for (const source of receipt.lines)
          if (
            groups
              .filter((g) => g.receiptLineId === source.id)
              .reduce((sum, g) => sum + g.quantity, 0) !== source.quantity
          )
            throw new BadRequestException(
              'Inspection must classify every received piece exactly once',
            );
        const deltas = new Map<string, number>();
        for (const g of groups)
          if (g.condition === 'GOOD')
            deltas.set(
              g.source.itemId,
              (deltas.get(g.source.itemId) ?? 0) + g.quantity,
            );
        await lockReturnItems(
          tx,
          receipt.lines.map((l) => l.itemId),
          receipt.merchantId,
          new Set(deltas.keys()),
        );
        const balances = deltas.size
          ? await this.posting.lockBalances(
              tx,
              receipt.warehouseId,
              receipt.merchantId,
              [...deltas.keys()],
            )
          : null;
        if (balances) this.posting.assertWithinRange(balances, deltas);
        const verified = await this.mutations.revalidate(
          tx,
          current,
          returnWriterRoles,
        );
        const inspectedAt = await this.database.time(tx);
        const inspection = await tx.returnInspection.create({
          data: {
            receiptId,
            warehouseId: receipt.warehouseId,
            merchantId: receipt.merchantId,
            inspectedById: verified.user.id,
            inspectedByNameSnapshot: verified.user.displayName,
            inspectedAt,
            idempotencyKey,
            requestHash,
            lines: {
              create: groups.map((g, index) => ({
                receiptId,
                receiptLineId: g.receiptLineId,
                itemId: g.source.itemId,
                warehouseId: receipt.warehouseId,
                merchantId: receipt.merchantId,
                position: index + 1,
                quantity: g.quantity,
                condition: g.condition,
                issueType: g.issueType,
                notes: g.notes,
              })),
            },
          },
          select: inspectionSelect,
        });
        const good = inspection.lines.filter((g) => g.condition === 'GOOD');
        if (good.length) {
          const movements = await tx.stockMovement.createManyAndReturn({
            data: good.map((g) => {
              const source = receipt.lines.find(
                (l) => l.id === g.receiptLineId,
              )!;
              return {
                warehouseId: receipt.warehouseId,
                merchantId: receipt.merchantId,
                itemId: g.itemId,
                itemCodeSnapshot: source.itemCodeSnapshot,
                itemNameSnapshot: source.itemNameSnapshot,
                kind: 'RETURN_IN' as const,
                quantityDelta: g.quantity,
                actorId: verified.user.id,
                actorNameSnapshot: verified.user.displayName,
                recordedAt: inspectedAt,
                returnInspectionLineId: g.id,
              };
            }),
          });
          for (const movement of movements) {
            const saved = inspection.lines.find(
              (g) => g.id === movement.returnInspectionLineId,
            )!;
            const requested = input.lines[saved.position - 1];
            await this.placements.allocateMovement(
              tx,
              movement,
              requested.placements,
            );
            await this.custody.release(
              tx,
              movement,
              requested.custodySources ?? requested.placements,
            );
          }
        }
        if (balances)
          await this.posting.apply(tx, balances, deltas, inspectedAt);
        return { replayed: false, inspection };
      },
    );
  }
}
