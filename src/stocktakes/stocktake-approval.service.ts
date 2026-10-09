import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { AuthenticationContext } from '../auth/authenticated-user.js';
import { PrismaService } from '../database/prisma.service.js';
import { StockPostingService } from '../inventory/stock-posting.service.js';
import { StockPlacementService } from '../inventory/stock-placement.service.js';
import { requestHash } from '../operation-control/request-identity.js';
import { StocktakeTransactionService } from './stocktake-transaction.service.js';
import type { ApproveStocktakeDto } from './dto/stocktake.dto.js';
@Injectable()
export class StocktakeApprovalService {
  constructor(
    @Inject(PrismaService) private readonly database: PrismaService,
    @Inject(StocktakeTransactionService)
    private readonly transactions: StocktakeTransactionService,
    @Inject(StockPostingService) private readonly posting: StockPostingService,
    @Inject(StockPlacementService)
    private readonly placements: StockPlacementService,
  ) {}
  approve(
    context: AuthenticationContext,
    id: string,
    key: string | undefined,
    input: ApproveStocktakeDto,
  ) {
    return this.transactions.run(
      context,
      key,
      'APPROVED',
      { id, notes: input.notes, confirmAttendance: input.confirmAttendance },
      true,
      ['ADMIN'],
      async (tx, current) => {
        const cycle = await this.transactions.lockCycle(tx, id, [
          'PENDING_APPROVAL',
        ]);
        if (!input.confirmAttendance)
          throw new ForbiddenException(
            'Administrator must confirm presence and final review',
          );
        await this.transactions.requireCounter(tx, cycle, current);
        const lines = await tx.stocktakeLine.findMany({
          where: { stocktakeId: id },
          orderBy: [
            { merchantId: 'asc' },
            { itemId: 'asc' },
            { shelfId: 'asc' },
          ],
        });
        if (lines.some((l) => l.version === 0))
          throw new ConflictException('Every line must be counted');
        const counts = await tx.stocktakeCountEntry.findMany({
          where: { lineId: { in: lines.map((l) => l.id) } },
        });
        const latest = new Map(
          counts.map((c) => [`${c.lineId}:${c.version}`, c]),
        );
        const differences = lines
          .map((line) => {
            const count = latest.get(`${line.id}:${line.version}`);
            if (!count)
              throw new ConflictException('Count revision is unavailable');
            return {
              line,
              count,
              delta: count.quantity - line.expectedQuantity,
            };
          })
          .filter((d) => d.delta !== 0);
        const stockDifferences = differences.filter(
          (d) => d.line.category === 'AVAILABLE',
        );
        if (stockDifferences.some((d) => !d.count.reason?.trim()))
          throw new ConflictException('Every stock difference needs a reason');
        // The SQL gate admits only stocktake posting tables for this active cycle.
        await tx.$executeRaw`SELECT set_config('stocked.stocktake_approval',${cycle.id},true)`;
        const closedAt = await this.database.time(tx);
        for (const merchantId of [
          ...new Set(stockDifferences.map((d) => d.line.merchantId)),
        ].sort()) {
          const group = stockDifferences.filter(
            (d) => d.line.merchantId === merchantId,
          );
          const balances = await this.posting.lockBalances(
            tx,
            cycle.warehouseId,
            merchantId,
            group.map((d) => d.line.itemId),
          );
          const deltas = new Map<string, number>();
          for (const d of group)
            deltas.set(
              d.line.itemId,
              (deltas.get(d.line.itemId) ?? 0) + d.delta,
            );
          this.posting.assertWithinRange(balances, deltas);
          const scope = await tx.stocktakeScope.findFirstOrThrow({
            where: { stocktakeId: id, merchantId },
          });
          for (const d of group) {
            const adjustment = await tx.stockAdjustment.create({
              data: {
                warehouseId: cycle.warehouseId,
                merchantId,
                itemId: d.line.itemId,
                merchantNameSnapshot: scope.merchantNameSnapshot,
                itemCodeSnapshot: d.line.itemCodeSnapshot,
                itemNameSnapshot: d.line.itemNameSnapshot,
                referenceMovementId: null,
                stocktakeLineId: d.line.id,
                direction: d.delta > 0 ? 'IN' : 'OUT',
                quantity: Math.abs(d.delta),
                quantityDelta: d.delta,
                reason: d.count.reason!,
                performedById: current.user.id,
                performedByNameSnapshot: current.user.displayName,
                recordedAt: closedAt,
                idempotencyKey: randomUUID(),
                requestHash: requestHash({
                  stocktakeId: id,
                  lineId: d.line.id,
                  version: d.line.version,
                }),
              },
            });
            const movement = await tx.stockMovement.create({
              data: {
                warehouseId: cycle.warehouseId,
                merchantId,
                itemId: d.line.itemId,
                itemCodeSnapshot: d.line.itemCodeSnapshot,
                itemNameSnapshot: d.line.itemNameSnapshot,
                kind: d.delta > 0 ? 'ADJUSTMENT_IN' : 'ADJUSTMENT_OUT',
                quantityDelta: d.delta,
                actorId: current.user.id,
                actorNameSnapshot: current.user.displayName,
                recordedAt: closedAt,
                adjustmentId: adjustment.id,
              },
            });
            await this.placements.allocateMovement(tx, movement, [
              { shelfId: d.line.shelfId, quantity: Math.abs(d.delta) },
            ]);
          }
          // Apply each item's net delta once, after all its movements exist. Net-zero
          // differences on separate shelves remain two audited settlements.
          await this.posting.apply(tx, balances, deltas, closedAt);
        }
        await tx.stocktake.update({
          where: { id },
          data: {
            status: 'APPROVED',
            closedById: current.user.id,
            closedByNameSnapshot: current.user.displayName,
            closedAt,
            closingNotes: input.notes,
          },
        });
        return {
          stocktakeId: id,
          details: {
            notes: input.notes,
            confirmAttendance: true,
            settlementCount: stockDifferences.length,
            custodyDifferenceCount:
              differences.length - stockDifferences.length,
          },
        };
      },
    );
  }
}
