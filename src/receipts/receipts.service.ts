import { canonicalShelfAllocations } from '../inventory/stock-placement-input.js';
import { StockPlacementService } from '../inventory/stock-placement.service.js';
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
import type { CreateReceiptDto } from './dto/create-receipt.dto.js';
import type { ListReceiptsDto } from './dto/list-receipts.dto.js';

const receiptRoles = [
  UserRole.ADMIN,
  UserRole.WAREHOUSE_KEEPER,
  UserRole.EMPLOYEE,
] as const;
const receiptSelect = {
  id: true,
  merchantId: true,
  merchantNameSnapshot: true,
  receivedById: true,
  receivedByNameSnapshot: true,
  receivedAt: true,
  notes: true,
  lines: {
    orderBy: { position: 'asc' as const },
    select: {
      id: true,
      itemId: true,
      itemCodeSnapshot: true,
      itemNameSnapshot: true,
      quantity: true,
      condition: true,
      issueType: true,
      notes: true,
      position: true,
      movement: { select: { id: true } },
    },
  },
} satisfies Prisma.ReceiptSelect;

@Injectable()
export class ReceiptsService {
  constructor(
    @Inject(StockPlacementService)
    private readonly placements: StockPlacementService,
    @Inject(PrismaService) private readonly database: PrismaService,
    @Inject(StockMutationService)
    private readonly mutations: StockMutationService,
    @Inject(StockPostingService) private readonly posting: StockPostingService,
  ) {}

  async create(
    context: AuthenticationContext,
    key: string | undefined,
    input: CreateReceiptDto,
  ) {
    if (
      !key ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        key,
      )
    )
      throw new BadRequestException('A valid Idempotency-Key UUID is required');
    this.validateConditions(input);
    const normalizedKey = key.toLowerCase();
    const merchantId = input.merchantId.toLowerCase();
    const requestHash = this.hash(input);
    return this.mutations.run(
      context,
      'receipt',
      normalizedKey,
      receiptRoles,
      async (tx, current) => {
        const warehouse = await tx.warehouse.findUnique({
          where: { code: 'MAIN' },
          select: { id: true },
        });
        if (!warehouse)
          throw new ConflictException('Main warehouse is not initialized');
        const previous = await tx.receipt.findUnique({
          where: {
            warehouseId_idempotencyKey: {
              warehouseId: warehouse.id,
              idempotencyKey: normalizedKey,
            },
          },
          select: { id: true, receivedById: true, requestHash: true },
        });
        if (previous) {
          if (
            previous.receivedById !== current.user.id ||
            previous.requestHash !== requestHash
          )
            throw new ConflictException('Idempotency key is already used');
          return {
            replayed: true,
            receipt: await tx.receipt.findUniqueOrThrow({
              where: { id: previous.id },
              select: receiptSelect,
            }),
          };
        }

        const [merchant] = await tx.$queryRaw<
          { id: string; name: string; is_active: boolean }[]
        >`
        SELECT id, name, is_active FROM merchants WHERE id = ${merchantId}::uuid FOR SHARE`;
        if (!merchant) throw new NotFoundException('Merchant not found');
        if (!merchant.is_active)
          throw new ConflictException('Merchant is inactive');
        const itemIds = [
          ...new Set(input.lines.map((line) => line.itemId.toLowerCase())),
        ].sort();
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
        WHERE id IN (${Prisma.join(itemIds.map((id) => Prisma.sql`${id}::uuid`))})
        ORDER BY id FOR SHARE`;
        if (
          items.length !== itemIds.length ||
          items.some((item) => item.merchant_id !== merchantId)
        )
          throw new NotFoundException('One or more items are unavailable');
        if (items.some((item) => !item.is_active))
          throw new ConflictException('Inactive items cannot be received');
        const itemById = new Map(items.map((item) => [item.id, item]));
        const balances = await this.posting.lockBalances(
          tx,
          warehouse.id,
          merchantId,
          itemIds,
        );
        const deltas = new Map<string, number>();
        for (const line of input.lines) {
          const itemId = line.itemId.toLowerCase();
          deltas.set(itemId, (deltas.get(itemId) ?? 0) + line.quantity);
        }
        this.posting.assertWithinRange(balances, deltas);
        const verified = await this.mutations.revalidate(
          tx,
          current,
          receiptRoles,
        );
        const receivedAt = await this.database.time(tx);
        const receipt = await tx.receipt.create({
          data: {
            warehouseId: warehouse.id,
            merchantId,
            merchantNameSnapshot: merchant.name,
            receivedById: verified.user.id,
            receivedByNameSnapshot: verified.user.displayName,
            receivedAt,
            notes: input.notes?.trim() || null,
            idempotencyKey: normalizedKey,
            requestHash,
          },
          select: { id: true },
        });
        const lineRecords = [];
        for (const [index, line] of input.lines.entries()) {
          const itemId = line.itemId.toLowerCase();
          const item = itemById.get(itemId)!;
          const record = await tx.receiptLine.create({
            data: {
              receiptId: receipt.id,
              warehouseId: warehouse.id,
              merchantId,
              itemId,
              position: index + 1,
              itemCodeSnapshot: item.code,
              itemNameSnapshot: item.name,
              quantity: line.quantity,
              condition: line.condition,
              issueType: line.condition === 'NOTED' ? line.issueType! : null,
              notes: line.condition === 'NOTED' ? line.notes!.trim() : null,
            },
          });
          lineRecords.push({ record, item });
        }
        for (const { record, item } of lineRecords) {
          const movement = await tx.stockMovement.create({
            data: {
              warehouseId: warehouse.id,
              merchantId,
              itemId: item.id,
              itemCodeSnapshot: item.code,
              itemNameSnapshot: item.name,
              kind: 'RECEIPT_IN',
              quantityDelta: record.quantity,
              actorId: verified.user.id,
              actorNameSnapshot: verified.user.displayName,
              recordedAt: receivedAt,
              receiptLineId: record.id,
            },
          });
          await this.placements.allocateMovement(
            tx,
            movement,
            input.lines[record.position - 1].placements,
          );
        }
        await this.posting.apply(tx, balances, deltas, receivedAt);
        return {
          replayed: false,
          receipt: await tx.receipt.findUniqueOrThrow({
            where: { id: receipt.id },
            select: receiptSelect,
          }),
        };
      },
    );
  }

  async list(context: AuthenticationContext, query: ListReceiptsDto) {
    this.assertDateRange(query.from, query.to);
    const merchantId = this.readMerchant(context, query.merchantId);
    const where: Prisma.ReceiptWhereInput = {
      ...(merchantId ? { merchantId } : {}),
      ...(query.actorId ? { receivedById: query.actorId } : {}),
      ...(query.from || query.to
        ? {
            receivedAt: {
              ...(query.from ? { gte: new Date(query.from) } : {}),
              ...(query.to ? { lt: new Date(query.to) } : {}),
            },
          }
        : {}),
    };
    const [receipts, total] = await this.database.$transaction(
      [
        this.database.receipt.findMany({
          where,
          select: receiptSelect,
          skip: (query.page - 1) * query.limit,
          take: query.limit,
          orderBy: [{ receivedAt: 'desc' }, { id: 'desc' }],
        }),
        this.database.receipt.count({ where }),
      ],
      { isolationLevel: 'RepeatableRead' },
    );
    return { items: receipts, total, page: query.page, limit: query.limit };
  }

  async get(context: AuthenticationContext, id: string) {
    const merchantId = this.readMerchant(context);
    const receipt = await this.database.receipt.findFirst({
      where: { id, ...(merchantId ? { merchantId } : {}) },
      select: receiptSelect,
    });
    if (!receipt) throw new NotFoundException('Receipt not found');
    return receipt;
  }

  private validateConditions(input: CreateReceiptDto): void {
    for (const line of input.lines) {
      const good = line.condition === 'GOOD';
      if (good && (line.issueType != null || line.notes != null))
        throw new BadRequestException(
          'GOOD receipt lines cannot include issue details',
        );
      if (
        !good &&
        (!line.issueType || !line.notes || line.notes.trim().length < 10)
      )
        throw new BadRequestException(
          'NOTED receipt lines require a defect type and detailed notes',
        );
    }
  }
  private hash(input: CreateReceiptDto): string {
    const canonical = {
      merchantId: input.merchantId.toLowerCase(),
      notes: input.notes?.trim() || null,
      lines: input.lines.map((line) => ({
        itemId: line.itemId.toLowerCase(),
        quantity: line.quantity,
        condition: line.condition,
        placements: canonicalShelfAllocations(line.placements),
        issueType: line.condition === 'NOTED' ? line.issueType : null,
        notes: line.condition === 'NOTED' ? line.notes?.trim() : null,
      })),
    };
    return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
  }
  private readMerchant(
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
  private assertDateRange(from?: string, to?: string): void {
    if (from && to && new Date(from) >= new Date(to))
      throw new BadRequestException('from must be earlier than to');
  }
}
