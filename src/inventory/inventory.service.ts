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
import type { ListInventoryDto } from './dto/list-inventory.dto.js';

const movementSelect = {
  id: true,
  merchantId: true,
  itemId: true,
  itemCodeSnapshot: true,
  itemNameSnapshot: true,
  kind: true,
  quantityDelta: true,
  actorId: true,
  actorNameSnapshot: true,
  recordedAt: true,
  receiptLine: {
    select: {
      id: true,
      quantity: true,
      condition: true,
      issueType: true,
      notes: true,
      receipt: {
        select: {
          id: true,
          merchantNameSnapshot: true,
          receivedByNameSnapshot: true,
          receivedAt: true,
        },
      },
    },
  },
  adjustment: {
    select: {
      id: true,
      direction: true,
      quantity: true,
      reason: true,
      performedByNameSnapshot: true,
      recordedAt: true,
      referenceMovementId: true,
    },
  },
} satisfies Prisma.StockMovementSelect;

@Injectable()
export class InventoryService {
  constructor(
    @Inject(PrismaService) private readonly database: PrismaService,
  ) {}

  async balances(context: AuthenticationContext, query: ListInventoryDto) {
    const merchantId = this.scope(context, query.merchantId);
    const where: Prisma.ItemWhereInput = {
      ...(merchantId ? { merchantId } : {}),
      ...(query.itemId ? { id: query.itemId } : {}),
    };
    const [warehouse] = await this.database.warehouse.findMany({
      where: { code: 'MAIN' },
      take: 1,
      select: { id: true },
    });
    if (!warehouse) throw new NotFoundException('Warehouse not found');
    const [items, total] = await this.database.$transaction(
      [
        this.database.item.findMany({
          where,
          select: {
            id: true,
            merchantId: true,
            code: true,
            name: true,
            isActive: true,
            balances: {
              where: { warehouseId: warehouse.id },
              select: { quantity: true, updatedAt: true },
            },
          },
          skip: query.itemId ? 0 : (query.page - 1) * query.limit,
          take: query.itemId ? 1 : query.limit,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        }),
        this.database.item.count({ where }),
      ],
      { isolationLevel: 'RepeatableRead' },
    );
    if (query.itemId && items.length === 0)
      throw new NotFoundException('Item not found');
    return {
      items: items.map((item) => ({
        itemId: item.id,
        merchantId: item.merchantId,
        itemCode: item.code,
        itemName: item.name,
        isActive: item.isActive,
        quantity: item.balances[0]?.quantity ?? 0,
        updatedAt: item.balances[0]?.updatedAt ?? null,
      })),
      total,
      page: query.page,
      limit: query.limit,
    };
  }

  async balance(context: AuthenticationContext, itemId: string) {
    const merchantId = this.scope(context);
    const [warehouse] = await this.database.warehouse.findMany({
      where: { code: 'MAIN' },
      take: 1,
      select: { id: true },
    });
    if (!warehouse) throw new NotFoundException('Warehouse not found');
    const item = await this.database.item.findFirst({
      where: { id: itemId, ...(merchantId ? { merchantId } : {}) },
      select: {
        id: true,
        merchantId: true,
        code: true,
        name: true,
        isActive: true,
        balances: {
          where: { warehouseId: warehouse.id },
          select: { quantity: true, updatedAt: true },
        },
      },
    });
    if (!item) throw new NotFoundException('Item not found');
    return {
      itemId: item.id,
      merchantId: item.merchantId,
      itemCode: item.code,
      itemName: item.name,
      isActive: item.isActive,
      quantity: item.balances[0]?.quantity ?? 0,
      updatedAt: item.balances[0]?.updatedAt ?? null,
    };
  }

  async movements(context: AuthenticationContext, query: ListInventoryDto) {
    this.assertDateRange(query.from, query.to);
    const merchantId = this.scope(context, query.merchantId);
    const where: Prisma.StockMovementWhereInput = {
      ...(merchantId ? { merchantId } : {}),
      ...(query.itemId ? { itemId: query.itemId } : {}),
      ...(query.actorId ? { actorId: query.actorId } : {}),
      ...(query.kind ? { kind: query.kind } : {}),
      ...(query.from || query.to
        ? {
            recordedAt: {
              ...(query.from ? { gte: new Date(query.from) } : {}),
              ...(query.to ? { lt: new Date(query.to) } : {}),
            },
          }
        : {}),
    };
    const [items, total] = await this.database.$transaction(
      [
        this.database.stockMovement.findMany({
          where,
          select: movementSelect,
          skip: (query.page - 1) * query.limit,
          take: query.limit,
          orderBy: [{ recordedAt: 'desc' }, { id: 'desc' }],
        }),
        this.database.stockMovement.count({ where }),
      ],
      { isolationLevel: 'RepeatableRead' },
    );
    return { items, total, page: query.page, limit: query.limit };
  }

  async movement(context: AuthenticationContext, id: string) {
    const merchantId = this.scope(context);
    const movement = await this.database.stockMovement.findFirst({
      where: { id, ...(merchantId ? { merchantId } : {}) },
      select: movementSelect,
    });
    if (!movement) throw new NotFoundException('Movement not found');
    return movement;
  }

  private scope(
    context: AuthenticationContext,
    requested?: string,
  ): string | undefined {
    if (context.user.role === UserRole.MERCHANT) {
      if (
        !context.user.merchantId ||
        (requested && requested !== context.user.merchantId)
      )
        throw new ForbiddenException('Access denied');
      return context.user.merchantId;
    }
    return requested;
  }
  private assertDateRange(from?: string, to?: string): void {
    if (from && to && new Date(from) >= new Date(to))
      throw new BadRequestException('from must be earlier than to');
  }
}
