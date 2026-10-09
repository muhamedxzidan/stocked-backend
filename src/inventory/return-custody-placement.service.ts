import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma, StockMovement } from '../generated/prisma/client.js';
import { PrismaService } from '../database/prisma.service.js';
import type { AuthenticationContext } from '../auth/authenticated-user.js';
import { StockMutationService } from './stock-mutation.service.js';
import { StockPlacementService } from './stock-placement.service.js';
import type {
  CustodyTransferDto,
  ShelfQuantityDto,
} from './dto/stock-placement.dto.js';
import {
  requireIdempotencyKey,
  requestHash,
} from '../operation-control/request-identity.js';
@Injectable()
export class ReturnCustodyPlacementService {
  constructor(
    @Inject(PrismaService) private readonly database: PrismaService,
    @Inject(StockMutationService)
    private readonly mutations: StockMutationService,
    @Inject(StockPlacementService)
    private readonly placements: StockPlacementService,
  ) {}

  async receive(
    tx: Prisma.TransactionClient,
    receiptLineId: string,
    input: readonly ShelfQuantityDto[] | undefined,
  ): Promise<void> {
    const line = await tx.returnReceiptLine.findUniqueOrThrow({
      where: { id: receiptLineId },
      include: { receipt: true },
    });
    const allocations = await this.placements.validateShelves(
      tx,
      line.warehouseId,
      line.merchantId,
      input,
      line.quantity,
    );
    const audit = {
      receiptLineId: line.id,
      kind: 'RECEIVE',
      actorId: line.receipt.receivedById,
      actorNameSnapshot: line.receipt.receivedByNameSnapshot,
      recordedAt: line.receipt.receivedAt,
    };
    await tx.returnCustodyEntry.create({
      data: { ...audit, shelfId: null, quantityDelta: -line.quantity },
    });
    for (const p of allocations)
      await tx.returnCustodyEntry.create({
        data: { ...audit, shelfId: p.shelfId, quantityDelta: p.quantity },
      });
  }

  async release(
    tx: Prisma.TransactionClient,
    movement: StockMovement,
    input: readonly ShelfQuantityDto[] | undefined,
  ): Promise<void> {
    const group = await tx.returnInspectionLine.findUniqueOrThrow({
      where: { id: movement.returnInspectionLineId! },
    });
    const allocations = await this.placements.validateShelves(
      tx,
      movement.warehouseId,
      movement.merchantId,
      input,
      movement.quantityDelta,
    );
    for (const p of allocations) {
      const [balance] = await tx.$queryRaw<
        { quantity: number }[]
      >`SELECT quantity FROM return_custody_balances WHERE receipt_line_id=${group.receiptLineId}::uuid AND shelf_id=${p.shelfId}::uuid FOR UPDATE`;
      if (!balance || balance.quantity < p.quantity)
        throw new ConflictException(
          'Insufficient return custody on selected shelf',
        );
    }
    const audit = {
      receiptLineId: group.receiptLineId,
      kind: 'RELEASE',
      movementId: movement.id,
      actorId: movement.actorId,
      actorNameSnapshot: movement.actorNameSnapshot,
      recordedAt: movement.recordedAt,
    };
    await tx.returnCustodyEntry.create({
      data: { ...audit, shelfId: null, quantityDelta: movement.quantityDelta },
    });
    for (const p of allocations)
      await tx.returnCustodyEntry.create({
        data: { ...audit, shelfId: p.shelfId, quantityDelta: -p.quantity },
      });
  }

  async transfer(
    context: AuthenticationContext,
    key: string | undefined,
    input: CustodyTransferDto,
  ) {
    const idempotencyKey = requireIdempotencyKey(key);
    const canonical = {
      receiptLineId: input.receiptLineId.toLowerCase(),
      fromShelfId: input.fromShelfId?.toLowerCase() ?? null,
      toShelfId: input.toShelfId.toLowerCase(),
      quantity: input.quantity,
      reason: input.reason.trim(),
    };
    if (canonical.fromShelfId === canonical.toShelfId)
      throw new BadRequestException('Source and destination must differ');
    const hash = requestHash(canonical);
    return this.mutations.run(
      context,
      'custody_transfer',
      idempotencyKey,
      ['ADMIN', 'WAREHOUSE_KEEPER'],
      async (tx, current) => {
        const previous = await tx.returnCustodyTransfer.findUnique({
          where: { idempotencyKey },
        });
        if (previous) {
          if (
            previous.actorId !== current.user.id ||
            previous.requestHash !== hash
          )
            throw new ConflictException('Idempotency key is already used');
          return { replayed: true, transfer: previous };
        }
        if (!canonical.fromShelfId && current.user.role !== 'ADMIN')
          throw new ForbiddenException(
            'Only administrator allocates legacy custody',
          );
        const source = await tx.returnReceiptLine.findUnique({
          where: { id: canonical.receiptLineId },
        });
        if (!source) throw new NotFoundException('Return source not found');
        await tx.$queryRaw`SELECT id FROM return_receipts WHERE id=${source.receiptId}::uuid FOR UPDATE`;
        await this.placements.validateShelves(
          tx,
          source.warehouseId,
          source.merchantId,
          [{ shelfId: canonical.toShelfId, quantity: canonical.quantity }],
          canonical.quantity,
        );
        if (canonical.fromShelfId)
          await this.placements.validateShelves(
            tx,
            source.warehouseId,
            source.merchantId,
            [{ shelfId: canonical.fromShelfId, quantity: canonical.quantity }],
            canonical.quantity,
          );
        const [balance] = await tx.$queryRaw<
          { quantity: number }[]
        >`SELECT quantity FROM return_custody_balances WHERE receipt_line_id=${source.id}::uuid AND shelf_id IS NOT DISTINCT FROM ${canonical.fromShelfId}::uuid FOR UPDATE`;
        if (!balance || balance.quantity < canonical.quantity)
          throw new ConflictException(
            'Insufficient custody at source location',
          );
        const verified = await this.mutations.revalidate(tx, current, [
          'ADMIN',
          'WAREHOUSE_KEEPER',
        ]);
        const recordedAt = await this.database.time(tx);
        const transfer = await tx.returnCustodyTransfer.create({
          data: {
            ...canonical,
            actorId: verified.user.id,
            actorNameSnapshot: verified.user.displayName,
            recordedAt,
            idempotencyKey,
            requestHash: hash,
          },
        });
        for (const entry of [
          {
            shelfId: canonical.fromShelfId,
            quantityDelta: -canonical.quantity,
          },
          { shelfId: canonical.toShelfId, quantityDelta: canonical.quantity },
        ].sort((a, b) => (a.shelfId ?? '').localeCompare(b.shelfId ?? '')))
          await tx.returnCustodyEntry.create({
            data: {
              receiptLineId: source.id,
              kind: 'TRANSFER',
              transferKey: transfer.id,
              actorId: verified.user.id,
              actorNameSnapshot: verified.user.displayName,
              recordedAt,
              ...entry,
            },
          });
        return { replayed: false, transfer };
      },
    );
  }
}
