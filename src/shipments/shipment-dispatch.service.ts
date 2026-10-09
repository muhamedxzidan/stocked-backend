import { canonicalItemShelfAllocations } from '../inventory/stock-placement-input.js';
import { StockPlacementService } from '../inventory/stock-placement.service.js';
import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../database/prisma.service.js';
import type { AuthenticationContext } from '../auth/authenticated-user.js';
import { StockMutationService } from '../inventory/stock-mutation.service.js';
import { StockPostingService } from '../inventory/stock-posting.service.js';
import type { DispatchShipmentDto } from './dto/dispatch-shipment.dto.js';
import { shipmentKey, shipmentHash } from './shipment-request-identity.js';
import { dispatchSelect, shipmentWriterRoles } from './shipment-select.js';

@Injectable()
export class ShipmentDispatchService {
  constructor(
    @Inject(StockPlacementService)
    private readonly placements: StockPlacementService,
    @Inject(PrismaService) private readonly database: PrismaService,
    @Inject(StockMutationService)
    private readonly mutations: StockMutationService,
    @Inject(StockPostingService) private readonly posting: StockPostingService,
  ) {}
  async dispatch(
    context: AuthenticationContext,
    id: string,
    key: string | undefined,
    input: DispatchShipmentDto,
  ) {
    const shipmentId = id.toLowerCase();
    const idempotencyKey = shipmentKey(key);
    const canonical = {
      shipmentId,
      carrierName: input.carrierName.trim(),
      trackingNumber: input.trackingNumber.trim(),
      placements: canonicalItemShelfAllocations(input.placements),
    };
    const requestHash = shipmentHash(canonical);
    return this.mutations.run(
      context,
      'shipment_dispatch',
      idempotencyKey,
      shipmentWriterRoles,
      async (tx, current) => {
        const warehouse = await tx.warehouse.findUnique({
          where: { code: 'MAIN' },
          select: { id: true },
        });
        if (!warehouse)
          throw new ConflictException('Main warehouse is not initialized');
        const previous = await tx.shipmentDispatch.findUnique({
          where: {
            warehouseId_idempotencyKey: {
              warehouseId: warehouse.id,
              idempotencyKey,
            },
          },
        });
        if (previous) {
          if (
            previous.dispatchedById !== current.user.id ||
            previous.requestHash !== requestHash
          )
            throw new ConflictException('Idempotency key is already used');
          return {
            replayed: true,
            dispatch: await tx.shipmentDispatch.findUniqueOrThrow({
              where: { id: previous.id },
              select: dispatchSelect,
            }),
          };
        }
        const shipment = await tx.shipment.findFirst({
          where: { id: shipmentId, warehouseId: warehouse.id },
          include: { lines: { orderBy: { position: 'asc' } } },
        });
        if (!shipment) throw new NotFoundException('Shipment not found');
        const [merchant] = await tx.$queryRaw<
          { is_active: boolean }[]
        >`SELECT is_active FROM merchants WHERE id=${shipment.merchantId}::uuid FOR SHARE`;
        if (!merchant?.is_active)
          throw new ConflictException('Merchant is inactive');
        await tx.$queryRaw`SELECT id FROM shipments WHERE id=${shipmentId}::uuid FOR UPDATE`;
        const preparation = await tx.shipmentPreparation.findUnique({
          where: { shipmentId },
          select: { id: true },
        });
        if (!preparation)
          throw new ConflictException(
            'Shipment must be prepared before dispatch',
          );
        if (
          await tx.shipmentDispatch.findUnique({
            where: { shipmentId },
            select: { id: true },
          })
        )
          throw new ConflictException('Shipment is already dispatched');
        const itemIds = shipment.lines.map((line) => line.itemId).sort();
        if (!itemIds.length)
          throw new ConflictException('Shipment has no lines');
        const items = await tx.$queryRaw<
          { id: string; merchant_id: string; is_active: boolean }[]
        >`
        SELECT id, merchant_id, is_active FROM items WHERE id IN (${Prisma.join(itemIds.map((itemId) => Prisma.sql`${itemId}::uuid`))}) ORDER BY id FOR SHARE`;
        if (
          items.length !== itemIds.length ||
          items.some(
            (item) =>
              item.merchant_id !== shipment.merchantId || !item.is_active,
          )
        )
          throw new ConflictException(
            'One or more shipment items are unavailable',
          );
        const balances = await this.posting.lockBalances(
          tx,
          warehouse.id,
          shipment.merchantId,
          itemIds,
        );
        const deltas = new Map(
          shipment.lines.map((line) => [line.itemId, -line.quantity]),
        );
        this.posting.assertWithinRange(balances, deltas);
        const verified = await this.mutations.revalidate(
          tx,
          current,
          shipmentWriterRoles,
        );
        const dispatchedAt = await this.database.time(tx);
        const dispatch = await tx.shipmentDispatch.create({
          data: {
            shipmentId,
            preparationId: preparation.id,
            warehouseId: warehouse.id,
            merchantId: shipment.merchantId,
            carrierName: canonical.carrierName,
            trackingNumber: canonical.trackingNumber,
            dispatchedById: verified.user.id,
            dispatchedByNameSnapshot: verified.user.displayName,
            dispatchedAt,
            idempotencyKey,
            requestHash,
          },
          select: dispatchSelect,
        });
        const movements = await tx.stockMovement.createManyAndReturn({
          data: shipment.lines.map((line) => ({
            warehouseId: warehouse.id,
            merchantId: shipment.merchantId,
            itemId: line.itemId,
            itemCodeSnapshot: line.itemCodeSnapshot,
            itemNameSnapshot: line.itemNameSnapshot,
            kind: 'SHIPMENT_OUT',
            quantityDelta: -line.quantity,
            actorId: verified.user.id,
            actorNameSnapshot: verified.user.displayName,
            recordedAt: dispatchedAt,
            shipmentLineId: line.id,
            shipmentDispatchId: dispatch.id,
          })),
        });
        if (
          input.placements?.some(
            (p) => !itemIds.includes(p.itemId.toLowerCase()),
          )
        )
          throw new ConflictException(
            'Allocation item does not belong to shipment',
          );
        for (const movement of movements)
          await this.placements.allocateMovement(
            tx,
            movement,
            input.placements?.filter(
              (p) => p.itemId.toLowerCase() === movement.itemId,
            ),
          );
        await this.posting.apply(tx, balances, deltas, dispatchedAt);
        return { replayed: false, dispatch };
      },
    );
  }
}
