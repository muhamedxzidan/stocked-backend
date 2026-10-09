import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, UserRole } from '../generated/prisma/client.js';
import { PrismaService } from '../database/prisma.service.js';
import type { AuthenticationContext } from '../auth/authenticated-user.js';
import { ListShipmentsDto, ShipmentStatus } from './dto/list-shipments.dto.js';
import { shipmentReadSelect } from './shipment-select.js';

type ShipmentRead = Prisma.ShipmentGetPayload<{
  select: typeof shipmentReadSelect;
}>;

@Injectable()
export class ShipmentsReadService {
  constructor(
    @Inject(PrismaService) private readonly database: PrismaService,
  ) {}
  async list(context: AuthenticationContext, query: ListShipmentsDto) {
    if (query.from && query.to && new Date(query.from) >= new Date(query.to))
      throw new BadRequestException('from must be earlier than to');
    const merchantId = this.scope(context, query.merchantId);
    const where: Prisma.ShipmentWhereInput = {
      ...(merchantId ? { merchantId } : {}),
      ...(query.itemId
        ? { lines: { some: { itemId: query.itemId.toLowerCase() } } }
        : {}),
      ...(query.actorId
        ? {
            OR: [
              { registeredById: query.actorId.toLowerCase() },
              {
                preparation: {
                  is: { preparedById: query.actorId.toLowerCase() },
                },
              },
              {
                dispatch: {
                  is: { dispatchedById: query.actorId.toLowerCase() },
                },
              },
            ],
          }
        : {}),
      ...(query.status === ShipmentStatus.REGISTERED
        ? { preparation: { is: null }, dispatch: { is: null } }
        : {}),
      ...(query.status === ShipmentStatus.PREPARED
        ? { preparation: { isNot: null }, dispatch: { is: null } }
        : {}),
      ...(query.status === ShipmentStatus.DISPATCHED
        ? { dispatch: { isNot: null } }
        : {}),
      ...(query.from || query.to
        ? {
            registeredAt: {
              ...(query.from ? { gte: new Date(query.from) } : {}),
              ...(query.to ? { lt: new Date(query.to) } : {}),
            },
          }
        : {}),
    };
    const [shipments, total] = await this.database.$transaction(
      [
        this.database.shipment.findMany({
          where,
          select: shipmentReadSelect,
          skip: (query.page - 1) * query.limit,
          take: query.limit,
          orderBy: [{ registeredAt: 'desc' }, { id: 'desc' }],
        }),
        this.database.shipment.count({ where }),
      ],
      { isolationLevel: 'RepeatableRead' },
    );
    return {
      items: shipments.map((shipment) => this.present(shipment)),
      total,
      page: query.page,
      limit: query.limit,
    };
  }
  async get(context: AuthenticationContext, id: string) {
    const merchantId = this.scope(context);
    // Nested relation reads must observe one snapshot when a milestone commits concurrently.
    const shipment = await this.database.$transaction(
      (tx) =>
        tx.shipment.findFirst({
          where: {
            id: id.toLowerCase(),
            ...(merchantId ? { merchantId } : {}),
          },
          select: shipmentReadSelect,
        }),
      { isolationLevel: 'RepeatableRead' },
    );
    if (!shipment) throw new NotFoundException('Shipment not found');
    return this.present(shipment);
  }
  private scope(
    context: AuthenticationContext,
    requested?: string,
  ): string | undefined {
    const normalized = requested?.toLowerCase();
    if (context.user.role === UserRole.MERCHANT) {
      if (
        !context.user.merchantId ||
        (normalized && normalized !== context.user.merchantId)
      )
        throw new ForbiddenException('Access denied');
      return context.user.merchantId;
    }
    return normalized;
  }
  private present(shipment: ShipmentRead) {
    const status = shipment.dispatch
      ? ShipmentStatus.DISPATCHED
      : shipment.preparation
        ? ShipmentStatus.PREPARED
        : ShipmentStatus.REGISTERED;
    const timeline = [
      {
        step: ShipmentStatus.REGISTERED,
        actorId: shipment.registeredById,
        actorNameSnapshot: shipment.registeredByNameSnapshot,
        recordedAt: shipment.registeredAt,
      },
    ];
    if (shipment.preparation)
      timeline.push({
        step: ShipmentStatus.PREPARED,
        actorId: shipment.preparation.preparedById,
        actorNameSnapshot: shipment.preparation.preparedByNameSnapshot,
        recordedAt: shipment.preparation.preparedAt,
      });
    if (shipment.dispatch)
      timeline.push({
        step: ShipmentStatus.DISPATCHED,
        actorId: shipment.dispatch.dispatchedById,
        actorNameSnapshot: shipment.dispatch.dispatchedByNameSnapshot,
        recordedAt: shipment.dispatch.dispatchedAt,
      });
    return { ...shipment, status, timeline };
  }
}
