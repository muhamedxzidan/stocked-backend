import { canonicalShelfAllocations } from '../inventory/stock-placement-input.js';
import { ReturnCustodyPlacementService } from '../inventory/return-custody-placement.service.js';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
} from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import type { AuthenticationContext } from '../auth/authenticated-user.js';
import { StockMutationService } from '../inventory/stock-mutation.service.js';
import type { ReceiveReturnDto } from './dto/receive-return.dto.js';
import { returnHash, returnKey } from './return-request-identity.js';
import { returnReceiptSelect, returnWriterRoles } from './return-select.js';
import { lockReturnItems, lockReturnShipment } from './return-source.js';

@Injectable()
export class ReturnReceivingService {
  constructor(
    @Inject(ReturnCustodyPlacementService)
    private readonly custody: ReturnCustodyPlacementService,
    @Inject(PrismaService) private readonly database: PrismaService,
    @Inject(StockMutationService)
    private readonly mutations: StockMutationService,
  ) {}
  async receive(
    context: AuthenticationContext,
    key: string | undefined,
    input: ReceiveReturnDto,
  ) {
    const idempotencyKey = returnKey(key);
    const canonical = {
      merchantId: input.merchantId.toLowerCase(),
      shipmentId: input.shipmentId.toLowerCase(),
      notes: input.notes?.trim() || null,
      lines: input.lines.map((l) => ({
        shipmentLineId: l.shipmentLineId.toLowerCase(),
        quantity: l.quantity,
        placements: canonicalShelfAllocations(l.placements),
      })),
    };
    if (
      new Set(canonical.lines.map((l) => l.shipmentLineId)).size !==
      canonical.lines.length
    )
      throw new BadRequestException('Shipment lines must be unique');
    const requestHash = returnHash(canonical);
    return this.mutations.run(
      context,
      'return_receive',
      idempotencyKey,
      returnWriterRoles,
      async (tx, current) => {
        const warehouse = await tx.warehouse.findUnique({
          where: { code: 'MAIN' },
          select: { id: true },
        });
        if (!warehouse)
          throw new ConflictException('Main warehouse is not initialized');
        const previous = await tx.returnReceipt.findUnique({
          where: {
            warehouseId_idempotencyKey: {
              warehouseId: warehouse.id,
              idempotencyKey,
            },
          },
        });
        if (previous) {
          if (
            previous.receivedById !== current.user.id ||
            previous.requestHash !== requestHash
          )
            throw new ConflictException('Idempotency key is already used');
          return {
            replayed: true,
            receipt: await tx.returnReceipt.findUniqueOrThrow({
              where: { id: previous.id },
              select: returnReceiptSelect,
            }),
          };
        }
        const { shipment, merchant } = await lockReturnShipment(
          tx,
          canonical.shipmentId,
          canonical.merchantId,
        );
        if (shipment.warehouseId !== warehouse.id)
          throw new ConflictException('Shipment belongs to another warehouse');
        const lines = canonical.lines.map((l) => {
          const source = shipment.lines.find((s) => s.id === l.shipmentLineId);
          if (!source)
            throw new BadRequestException(
              'Return line does not belong to shipment',
            );
          return { ...l, source };
        });
        const totals = await tx.returnReceiptLine.groupBy({
          by: ['shipmentLineId'],
          where: { shipmentLineId: { in: lines.map((l) => l.shipmentLineId) } },
          _sum: { quantity: true },
        });
        for (const l of lines)
          if (
            l.quantity +
              (totals.find((t) => t.shipmentLineId === l.shipmentLineId)?._sum
                .quantity ?? 0) >
            l.source.quantity
          )
            throw new ConflictException(
              'Physical returns exceed dispatched quantity',
            );
        await lockReturnItems(
          tx,
          lines.map((l) => l.source.itemId),
          canonical.merchantId,
          new Set(),
        );
        const verified = await this.mutations.revalidate(
          tx,
          current,
          returnWriterRoles,
        );
        const receivedAt = await this.database.time(tx);
        const receipt = await tx.returnReceipt.create({
          data: {
            warehouseId: warehouse.id,
            merchantId: canonical.merchantId,
            shipmentId: shipment.id,
            dispatchId: shipment.dispatch!.id,
            merchantNameSnapshot: merchant.name,
            shipmentCodeSnapshot: shipment.code,
            receivedById: verified.user.id,
            receivedByNameSnapshot: verified.user.displayName,
            receivedAt,
            notes: canonical.notes,
            idempotencyKey,
            requestHash,
            lines: {
              create: lines.map((l, index) => ({
                shipmentId: shipment.id,
                shipmentLineId: l.shipmentLineId,
                warehouseId: warehouse.id,
                merchantId: canonical.merchantId,
                itemId: l.source.itemId,
                itemCodeSnapshot: l.source.itemCodeSnapshot,
                itemNameSnapshot: l.source.itemNameSnapshot,
                quantity: l.quantity,
                position: index + 1,
              })),
            },
          },
          select: returnReceiptSelect,
        });
        for (const line of receipt.lines)
          await this.custody.receive(
            tx,
            line.id,
            input.lines[line.position - 1].placements,
          );
        return { replayed: false, receipt };
      },
    );
  }
}
