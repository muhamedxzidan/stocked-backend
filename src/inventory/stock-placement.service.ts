import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, type StockMovement } from '../generated/prisma/client.js';
import { PrismaService } from '../database/prisma.service.js';
import type { AuthenticationContext } from '../auth/authenticated-user.js';
import { StockMutationService } from './stock-mutation.service.js';
import { StockPostingService } from './stock-posting.service.js';
import type {
  PlacementTransferDto,
  ShelfQuantityDto,
} from './dto/stock-placement.dto.js';
import { createHash } from 'node:crypto';
import { requireIdempotencyKey } from '../operation-control/request-identity.js';

@Injectable()
export class StockPlacementService {
  constructor(
    @Inject(PrismaService) private readonly database: PrismaService,
    @Inject(StockMutationService)
    private readonly mutations: StockMutationService,
    @Inject(StockPostingService) private readonly posting: StockPostingService,
  ) {}

  async validateShelves(
    tx: Prisma.TransactionClient,
    warehouseId: string,
    merchantId: string,
    placements: readonly ShelfQuantityDto[] | undefined,
    quantity: number,
  ): Promise<readonly ShelfQuantityDto[]> {
    if (
      !placements?.length ||
      placements.reduce((sum, p) => sum + p.quantity, 0) !== quantity ||
      new Set(placements.map((p) => p.shelfId.toLowerCase())).size !==
        placements.length
    )
      throw new BadRequestException(
        'Shelf allocations must be unique and cover the complete quantity',
      );
    const canonical = placements
      .map((p) => ({ shelfId: p.shelfId.toLowerCase(), quantity: p.quantity }))
      .sort((a, b) => a.shelfId.localeCompare(b.shelfId));
    for (const p of canonical) {
      const [shelf] = await tx.$queryRaw<
        { id: string }[]
      >`SELECT s.id FROM storage_shelves s JOIN storage_rows r ON r.id=s.row_id WHERE s.id=${p.shelfId}::uuid AND s.warehouse_id=${warehouseId}::uuid AND s.merchant_id=${merchantId}::uuid AND s.is_active AND r.is_active FOR SHARE OF s,r`;
      if (!shelf)
        throw new BadRequestException(
          'Shelf is inactive or belongs to another merchant',
        );
    }
    return canonical;
  }

  async allocateMovement(
    tx: Prisma.TransactionClient,
    movement: StockMovement,
    input: readonly ShelfQuantityDto[] | undefined,
  ): Promise<void> {
    const placements = await this.validateShelves(
      tx,
      movement.warehouseId,
      movement.merchantId,
      input,
      Math.abs(movement.quantityDelta),
    );
    if (movement.quantityDelta < 0) {
      for (const p of placements) {
        const [balance] = await tx.$queryRaw<
          { quantity: number }[]
        >`SELECT quantity FROM stock_placement_balances WHERE warehouse_id=${movement.warehouseId}::uuid AND item_id=${movement.itemId}::uuid AND shelf_id=${p.shelfId}::uuid FOR UPDATE`;
        if (!balance || balance.quantity < p.quantity)
          throw new ConflictException('Insufficient stock on selected shelf');
      }
    }
    const audit = {
      warehouseId: movement.warehouseId,
      merchantId: movement.merchantId,
      itemId: movement.itemId,
      kind: 'MOVEMENT',
      movementId: movement.id,
      actorId: movement.actorId,
      actorNameSnapshot: movement.actorNameSnapshot,
      recordedAt: movement.recordedAt,
    };
    // SQL initially places each movement in the unassigned pool. Reverse that entry
    // and redistribute the exact same movement; no extra warehouse stock is created.
    await tx.stockPlacementEntry.create({
      data: { ...audit, shelfId: null, quantityDelta: -movement.quantityDelta },
    });
    for (const p of placements)
      await tx.stockPlacementEntry.create({
        data: {
          ...audit,
          shelfId: p.shelfId,
          quantityDelta: Math.sign(movement.quantityDelta) * p.quantity,
        },
      });
  }

  async transfer(
    context: AuthenticationContext,
    key: string | undefined,
    input: PlacementTransferDto,
  ) {
    const idempotencyKey = requireIdempotencyKey(key);
    const canonical = {
      itemId: input.itemId.toLowerCase(),
      fromShelfId: input.fromShelfId?.toLowerCase() ?? null,
      toShelfId: input.toShelfId.toLowerCase(),
      quantity: input.quantity,
      reason: input.reason.trim(),
    };
    if (canonical.fromShelfId === canonical.toShelfId)
      throw new BadRequestException('Source and destination must differ');
    const requestHash = createHash('sha256')
      .update(JSON.stringify(canonical))
      .digest('hex');
    return this.mutations.run(
      context,
      'placement_transfer',
      idempotencyKey,
      ['ADMIN', 'WAREHOUSE_KEEPER'],
      async (tx, current) => {
        const previous = await tx.stockPlacementTransfer.findUnique({
          where: { idempotencyKey },
        });
        if (previous) {
          if (
            previous.actorId !== current.user.id ||
            previous.requestHash !== requestHash
          )
            throw new ConflictException('Idempotency key is already used');
          return { replayed: true, transfer: previous };
        }
        if (!canonical.fromShelfId && current.user.role !== 'ADMIN')
          throw new ForbiddenException(
            'Only administrator can allocate legacy stock',
          );
        const item = await tx.item.findUnique({
          where: { id: canonical.itemId },
        });
        const warehouse = await tx.warehouse.findUnique({
          where: { code: 'MAIN' },
        });
        if (!item || !warehouse)
          throw new NotFoundException('Stock source not found');
        await this.validateShelves(
          tx,
          warehouse.id,
          item.merchantId,
          [{ shelfId: canonical.toShelfId, quantity: canonical.quantity }],
          canonical.quantity,
        );
        if (canonical.fromShelfId)
          await this.validateShelves(
            tx,
            warehouse.id,
            item.merchantId,
            [{ shelfId: canonical.fromShelfId, quantity: canonical.quantity }],
            canonical.quantity,
          );
        await this.posting.lockBalances(tx, warehouse.id, item.merchantId, [
          item.id,
        ]);
        const [source] = await tx.$queryRaw<
          { quantity: number }[]
        >`SELECT quantity FROM stock_placement_balances WHERE warehouse_id=${warehouse.id}::uuid AND item_id=${item.id}::uuid AND shelf_id IS NOT DISTINCT FROM ${canonical.fromShelfId}::uuid FOR UPDATE`;
        if (!source || source.quantity < canonical.quantity)
          throw new ConflictException('Insufficient stock at source location');
        const verified = await this.mutations.revalidate(tx, current, [
          'ADMIN',
          'WAREHOUSE_KEEPER',
        ]);
        const recordedAt = await this.database.time(tx);
        const transfer = await tx.stockPlacementTransfer.create({
          data: {
            ...canonical,
            warehouseId: warehouse.id,
            merchantId: item.merchantId,
            actorId: verified.user.id,
            actorNameSnapshot: verified.user.displayName,
            recordedAt,
            idempotencyKey,
            requestHash,
          },
        });
        const audit = {
          warehouseId: warehouse.id,
          merchantId: item.merchantId,
          itemId: item.id,
          kind: 'TRANSFER',
          transferId: transfer.id,
          actorId: verified.user.id,
          actorNameSnapshot: verified.user.displayName,
          recordedAt,
        };
        for (const entry of [
          {
            shelfId: canonical.fromShelfId,
            quantityDelta: -canonical.quantity,
          },
          { shelfId: canonical.toShelfId, quantityDelta: canonical.quantity },
        ].sort((a, b) => (a.shelfId ?? '').localeCompare(b.shelfId ?? '')))
          await tx.stockPlacementEntry.create({ data: { ...audit, ...entry } });
        return { replayed: false, transfer };
      },
    );
  }
}
