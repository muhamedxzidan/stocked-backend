import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../database/prisma.service.js';
import type { AuthenticationContext } from '../auth/authenticated-user.js';
import { StockMutationService } from '../inventory/stock-mutation.service.js';
import { ShipmentCodeService } from './shipment-code.service.js';
import type { RegisterShipmentDto } from './dto/register-shipment.dto.js';
import { shipmentKey, shipmentHash } from './shipment-request-identity.js';
import { registrationSelect, shipmentWriterRoles } from './shipment-select.js';

@Injectable()
export class ShipmentRegistrationService {
  constructor(
    @Inject(PrismaService) private readonly database: PrismaService,
    @Inject(StockMutationService)
    private readonly mutations: StockMutationService,
    @Inject(ShipmentCodeService) private readonly codes: ShipmentCodeService,
  ) {}
  async register(
    context: AuthenticationContext,
    key: string | undefined,
    input: RegisterShipmentDto,
  ) {
    const idempotencyKey = shipmentKey(key);
    const canonical = {
      merchantId: input.merchantId.toLowerCase(),
      notes: input.notes?.trim() || null,
      lines: input.lines.map((line) => ({
        itemId: line.itemId.toLowerCase(),
        quantity: line.quantity,
      })),
    };
    const itemIds = [
      ...new Set(canonical.lines.map((line) => line.itemId)),
    ].sort();
    if (itemIds.length !== canonical.lines.length)
      throw new BadRequestException('Duplicate shipment items are not allowed');
    const requestHash = shipmentHash(canonical);
    return this.mutations.run(
      context,
      'shipment_register',
      idempotencyKey,
      shipmentWriterRoles,
      async (tx, current) => {
        const warehouse = await tx.warehouse.findUnique({
          where: { code: 'MAIN' },
          select: { id: true },
        });
        if (!warehouse)
          throw new ConflictException('Main warehouse is not initialized');
        const previous = await tx.shipment.findUnique({
          where: {
            warehouseId_idempotencyKey: {
              warehouseId: warehouse.id,
              idempotencyKey,
            },
          },
        });
        if (previous) {
          if (
            previous.registeredById !== current.user.id ||
            previous.requestHash !== requestHash
          )
            throw new ConflictException('Idempotency key is already used');
          return {
            replayed: true,
            shipment: await tx.shipment.findUniqueOrThrow({
              where: { id: previous.id },
              select: registrationSelect,
            }),
          };
        }
        const [merchant] = await tx.$queryRaw<
          { id: string; name: string; is_active: boolean }[]
        >`
        SELECT id, name, is_active FROM merchants WHERE id=${canonical.merchantId}::uuid FOR SHARE`;
        if (!merchant) throw new NotFoundException('Merchant not found');
        if (!merchant.is_active)
          throw new ConflictException('Merchant is inactive');
        const items = await tx.$queryRaw<
          {
            id: string;
            merchant_id: string;
            code: string;
            name: string;
            is_active: boolean;
          }[]
        >`
        SELECT id, merchant_id, code, name, is_active FROM items
        WHERE id IN (${Prisma.join(itemIds.map((id) => Prisma.sql`${id}::uuid`))}) ORDER BY id FOR SHARE`;
        if (
          items.length !== itemIds.length ||
          items.some((item) => item.merchant_id !== canonical.merchantId)
        )
          throw new NotFoundException('One or more items are unavailable');
        if (items.some((item) => !item.is_active))
          throw new ConflictException('Inactive items cannot be shipped');
        const code = await this.codes.allocate(tx, warehouse.id);
        const verified = await this.mutations.revalidate(
          tx,
          current,
          shipmentWriterRoles,
        );
        const registeredAt = await this.database.time(tx);
        const shipment = await tx.shipment.create({
          data: {
            warehouseId: warehouse.id,
            merchantId: merchant.id,
            code,
            merchantNameSnapshot: merchant.name,
            registeredById: verified.user.id,
            registeredByNameSnapshot: verified.user.displayName,
            registeredAt,
            notes: canonical.notes,
            idempotencyKey,
            requestHash,
          },
          select: { id: true },
        });
        const byId = new Map(items.map((item) => [item.id, item]));
        await tx.shipmentLine.createMany({
          data: canonical.lines.map((line, index) => ({
            shipmentId: shipment.id,
            warehouseId: warehouse.id,
            merchantId: merchant.id,
            itemId: line.itemId,
            position: index + 1,
            quantity: line.quantity,
            itemCodeSnapshot: byId.get(line.itemId)!.code,
            itemNameSnapshot: byId.get(line.itemId)!.name,
          })),
        });
        return {
          replayed: false,
          shipment: await tx.shipment.findUniqueOrThrow({
            where: { id: shipment.id },
            select: registrationSelect,
          }),
        };
      },
    );
  }
}
