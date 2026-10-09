import { ConflictException, Inject, Injectable } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../database/prisma.service.js';

export interface LockedBalances {
  readonly warehouseId: string;
  readonly merchantId: string;
  readonly quantities: ReadonlyMap<string, number>;
}

@Injectable()
export class StockPostingService {
  constructor(
    @Inject(PrismaService) private readonly database: PrismaService,
  ) {}

  async lockBalances(
    transaction: Prisma.TransactionClient,
    warehouseId: string,
    merchantId: string,
    itemIds: readonly string[],
  ): Promise<LockedBalances> {
    const ids = [...new Set(itemIds)].sort();
    const quantities = new Map<string, number>();
    for (const itemId of ids) {
      await transaction.$executeRaw`
        INSERT INTO inventory_balances (warehouse_id, merchant_id, item_id, quantity, updated_at)
        VALUES (${warehouseId}::uuid, ${merchantId}::uuid, ${itemId}::uuid, 0, clock_timestamp())
        ON CONFLICT (warehouse_id, item_id) DO NOTHING`;
      const [balance] = await transaction.$queryRaw<{ quantity: number }[]>`
        SELECT quantity FROM inventory_balances
        WHERE warehouse_id = ${warehouseId}::uuid AND item_id = ${itemId}::uuid
        FOR UPDATE`;
      if (!balance) throw new ConflictException('Stock balance is unavailable');
      quantities.set(itemId, balance.quantity);
    }
    return { warehouseId, merchantId, quantities };
  }

  assertWithinRange(
    balances: LockedBalances,
    deltas: ReadonlyMap<string, number>,
  ): void {
    for (const [itemId, delta] of deltas) {
      const next = (balances.quantities.get(itemId) ?? 0) + delta;
      if (!Number.isSafeInteger(next) || next < 0 || next > 2_147_483_647)
        throw new ConflictException(
          'Stock quantity would be outside allowed range',
        );
    }
  }

  async apply(
    transaction: Prisma.TransactionClient,
    balances: LockedBalances,
    deltas: ReadonlyMap<string, number>,
    recordedAt: Date,
  ): Promise<void> {
    for (const [itemId, delta] of deltas) {
      const next = (balances.quantities.get(itemId) ?? 0) + delta;
      await transaction.inventoryBalance.update({
        where: {
          warehouseId_itemId: { warehouseId: balances.warehouseId, itemId },
        },
        data: {
          merchantId: balances.merchantId,
          quantity: next,
          updatedAt: recordedAt,
        },
      });
    }
  }
}
