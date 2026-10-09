import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import type { AuthenticationContext } from '../auth/authenticated-user.js';
import { StockMutationService } from '../inventory/stock-mutation.service.js';
import { shipmentKey, shipmentHash } from './shipment-request-identity.js';
import { preparationSelect, shipmentWriterRoles } from './shipment-select.js';

@Injectable()
export class ShipmentPreparationService {
  constructor(
    @Inject(PrismaService) private readonly database: PrismaService,
    @Inject(StockMutationService)
    private readonly mutations: StockMutationService,
  ) {}
  async prepare(
    context: AuthenticationContext,
    id: string,
    key: string | undefined,
  ) {
    const shipmentId = id.toLowerCase();
    const idempotencyKey = shipmentKey(key);
    const requestHash = shipmentHash({ shipmentId });
    return this.mutations.run(
      context,
      'shipment_prepare',
      idempotencyKey,
      shipmentWriterRoles,
      async (tx, current) => {
        const warehouse = await tx.warehouse.findUnique({
          where: { code: 'MAIN' },
          select: { id: true },
        });
        if (!warehouse)
          throw new ConflictException('Main warehouse is not initialized');
        const previous = await tx.shipmentPreparation.findUnique({
          where: {
            warehouseId_idempotencyKey: {
              warehouseId: warehouse.id,
              idempotencyKey,
            },
          },
        });
        if (previous) {
          if (
            previous.preparedById !== current.user.id ||
            previous.requestHash !== requestHash
          )
            throw new ConflictException('Idempotency key is already used');
          return {
            replayed: true,
            preparation: await tx.shipmentPreparation.findUniqueOrThrow({
              where: { id: previous.id },
              select: preparationSelect,
            }),
          };
        }
        const shipment = await tx.shipment.findFirst({
          where: { id: shipmentId, warehouseId: warehouse.id },
        });
        if (!shipment) throw new NotFoundException('Shipment not found');
        const [merchant] = await tx.$queryRaw<
          { is_active: boolean }[]
        >`SELECT is_active FROM merchants WHERE id=${shipment.merchantId}::uuid FOR SHARE`;
        if (!merchant?.is_active)
          throw new ConflictException('Merchant is inactive');
        await tx.$queryRaw`SELECT id FROM shipments WHERE id=${shipmentId}::uuid FOR UPDATE`;
        if (
          await tx.shipmentPreparation.findUnique({
            where: { shipmentId },
            select: { id: true },
          })
        )
          throw new ConflictException('Shipment is already prepared');
        const verified = await this.mutations.revalidate(
          tx,
          current,
          shipmentWriterRoles,
        );
        const preparedAt = await this.database.time(tx);
        const preparation = await tx.shipmentPreparation.create({
          data: {
            shipmentId,
            warehouseId: warehouse.id,
            merchantId: shipment.merchantId,
            preparedById: verified.user.id,
            preparedByNameSnapshot: verified.user.displayName,
            preparedAt,
            idempotencyKey,
            requestHash,
          },
          select: preparationSelect,
        });
        return { replayed: false, preparation };
      },
    );
  }
}
