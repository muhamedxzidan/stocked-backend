import { createHash } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, UserRole } from '../generated/prisma/client.js';
import { PrismaService } from '../database/prisma.service.js';
import type { AuthenticationContext } from '../auth/authenticated-user.js';
import { StockMutationService } from '../inventory/stock-mutation.service.js';
import { StockPostingService } from '../inventory/stock-posting.service.js';
import type { CreateAdjustmentDto } from './dto/create-adjustment.dto.js';
import type { ListAdjustmentsDto } from './dto/list-adjustments.dto.js';
const adjustmentRoles = [UserRole.ADMIN, UserRole.WAREHOUSE_KEEPER] as const;
const adjustmentSelect = {
  id: true,
  merchantId: true,
  merchantNameSnapshot: true,
  itemId: true,
  itemCodeSnapshot: true,
  itemNameSnapshot: true,
  referenceMovementId: true,
  direction: true,
  quantity: true,
  quantityDelta: true,
  reason: true,
  performedById: true,
  performedByNameSnapshot: true,
  recordedAt: true,
  movement: { select: { id: true, kind: true, quantityDelta: true } },
} satisfies Prisma.StockAdjustmentSelect;
@Injectable()
export class StockAdjustmentsService {
  constructor(
    @Inject(PrismaService) private readonly database: PrismaService,
    @Inject(StockMutationService)
    private readonly mutations: StockMutationService,
    @Inject(StockPostingService) private readonly posting: StockPostingService,
  ) {}
  async create(
    context: AuthenticationContext,
    key: string | undefined,
    input: CreateAdjustmentDto,
  ) {
    if (
      !key ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        key,
      )
    )
      throw new BadRequestException('A valid Idempotency-Key UUID is required');
    if (input.reason.trim().length < 10)
      throw new BadRequestException(
        'reason must contain at least 10 characters',
      );
    const normalizedKey = key.toLowerCase();
    const hash = createHash('sha256')
      .update(
        JSON.stringify({
          referenceMovementId: input.referenceMovementId.toLowerCase(),
          direction: input.direction,
          quantity: input.quantity,
          reason: input.reason.trim(),
        }),
      )
      .digest('hex');
    return this.mutations.run(
      context,
      'adjustment',
      normalizedKey,
      adjustmentRoles,
      async (tx, current) => {
        const [warehouse] = await tx.$queryRaw<
          { id: string }[]
        >`SELECT id FROM warehouses WHERE code='MAIN'`;
        if (!warehouse)
          throw new ConflictException('Main warehouse is not initialized');
        const previous = await tx.stockAdjustment.findUnique({
          where: {
            warehouseId_idempotencyKey: {
              warehouseId: warehouse.id,
              idempotencyKey: normalizedKey,
            },
          },
          select: { id: true, performedById: true, requestHash: true },
        });
        if (previous) {
          if (
            previous.performedById !== current.user.id ||
            previous.requestHash !== hash
          )
            throw new ConflictException('Idempotency key is already used');
          return {
            replayed: true,
            adjustment: await tx.stockAdjustment.findUniqueOrThrow({
              where: { id: previous.id },
              select: adjustmentSelect,
            }),
          };
        }
        const [source] = await tx.$queryRaw<
          {
            id: string;
            warehouse_id: string;
            merchant_id: string;
            item_id: string;
            item_code: string;
            item_name: string;
            kind: string;
          }[]
        >`
        SELECT id, warehouse_id, merchant_id, item_id, item_code_snapshot AS item_code,
          item_name_snapshot AS item_name, kind
        FROM stock_movements WHERE id=${input.referenceMovementId}::uuid`;
        if (
          !source ||
          source.warehouse_id !== warehouse.id ||
          source.kind !== 'RECEIPT_IN'
        )
          throw new NotFoundException('Receipt movement not found');
        const [merchant] = await tx.$queryRaw<
          { id: string; name: string; is_active: boolean }[]
        >`SELECT id, name, is_active FROM merchants WHERE id=${source.merchant_id}::uuid FOR SHARE`;
        if (!merchant?.is_active)
          throw new ConflictException('Merchant is inactive');
        const [item] = await tx.$queryRaw<
          { id: string }[]
        >`SELECT id FROM items WHERE id=${source.item_id}::uuid AND merchant_id=${source.merchant_id}::uuid FOR SHARE`;
        if (!item) throw new NotFoundException('Receipt item not found');
        const delta =
          input.direction === 'IN' ? input.quantity : -input.quantity;
        const balances = await this.posting.lockBalances(
          tx,
          warehouse.id,
          source.merchant_id,
          [source.item_id],
        );
        const deltas = new Map([[source.item_id, delta]]);
        this.posting.assertWithinRange(balances, deltas);
        const verified = await this.mutations.revalidate(
          tx,
          current,
          adjustmentRoles,
        );
        const recordedAt = await this.database.time(tx);
        const adjustment = await tx.stockAdjustment.create({
          data: {
            warehouseId: warehouse.id,
            merchantId: source.merchant_id,
            merchantNameSnapshot: merchant.name,
            itemId: source.item_id,
            itemCodeSnapshot: source.item_code,
            itemNameSnapshot: source.item_name,
            referenceMovementId: source.id,
            direction: input.direction,
            quantity: input.quantity,
            quantityDelta: delta,
            reason: input.reason.trim(),
            performedById: verified.user.id,
            performedByNameSnapshot: verified.user.displayName,
            recordedAt,
            idempotencyKey: normalizedKey,
            requestHash: hash,
          },
          select: { id: true },
        });
        await tx.stockMovement.create({
          data: {
            warehouseId: warehouse.id,
            merchantId: source.merchant_id,
            itemId: source.item_id,
            itemCodeSnapshot: source.item_code,
            itemNameSnapshot: source.item_name,
            kind: delta > 0 ? 'ADJUSTMENT_IN' : 'ADJUSTMENT_OUT',
            quantityDelta: delta,
            actorId: verified.user.id,
            actorNameSnapshot: verified.user.displayName,
            recordedAt,
            adjustmentId: adjustment.id,
          },
        });
        await this.posting.apply(tx, balances, deltas, recordedAt);
        return {
          replayed: false,
          adjustment: await tx.stockAdjustment.findUniqueOrThrow({
            where: { id: adjustment.id },
            select: adjustmentSelect,
          }),
        };
      },
    );
  }
  async list(context: AuthenticationContext, query: ListAdjustmentsDto) {
    if (query.from && query.to && new Date(query.from) >= new Date(query.to))
      throw new BadRequestException('from must be earlier than to');
    const merchantId = this.scope(context, query.merchantId);
    const where: Prisma.StockAdjustmentWhereInput = {
      ...(merchantId ? { merchantId } : {}),
      ...(query.actorId ? { performedById: query.actorId } : {}),
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
        this.database.stockAdjustment.findMany({
          where,
          select: adjustmentSelect,
          skip: (query.page - 1) * query.limit,
          take: query.limit,
          orderBy: [{ recordedAt: 'desc' }, { id: 'desc' }],
        }),
        this.database.stockAdjustment.count({ where }),
      ],
      { isolationLevel: 'RepeatableRead' },
    );
    return { items, total, page: query.page, limit: query.limit };
  }
  async get(context: AuthenticationContext, id: string) {
    const merchantId = this.scope(context);
    const adjustment = await this.database.stockAdjustment.findFirst({
      where: { id, ...(merchantId ? { merchantId } : {}) },
      select: adjustmentSelect,
    });
    if (!adjustment) throw new NotFoundException('Stock adjustment not found');
    return adjustment;
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
}
