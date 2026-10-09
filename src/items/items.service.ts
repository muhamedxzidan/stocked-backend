import { AuditEventWriter } from '../audit-events/audit-event-writer.js';
import { OperationalWriteGateService } from '../operation-control/operational-write-gate.service.js';
import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../database/prisma.service.js';
import { SessionService } from '../auth/session.service.js';
import { AdminMutationService } from '../auth/admin-mutation.service.js';
import type { AuthenticationContext } from '../auth/authenticated-user.js';
import type { CreateItemDto } from './dto/create-item.dto.js';
import type { UpdateItemDto } from './dto/update-item.dto.js';
import type { ListItemsDto } from './dto/list-items.dto.js';
import { ItemCodeService } from './item-code.service.js';
import { itemSelection } from './item-selection.js';
import { presentItem } from './item-response.mapper.js';
@Injectable()
export class ItemsService {
  constructor(
    @Inject(AuditEventWriter) private readonly audit: AuditEventWriter,
    @Inject(OperationalWriteGateService)
    private readonly gate: OperationalWriteGateService,
    @Inject(PrismaService) private readonly database: PrismaService,
    @Inject(SessionService) private readonly sessions: SessionService,
    @Inject(AdminMutationService)
    private readonly mutations: AdminMutationService,
    @Inject(ItemCodeService) private readonly codes: ItemCodeService,
  ) {}
  async create(context: AuthenticationContext, input: CreateItemDto) {
    return this.database.$transaction(async (transaction) => {
      await this.gate.enter(transaction);
      await this.sessions.lockUser(transaction, context.user.id);
      const current = await this.sessions.validate(
        transaction,
        context.sessionId,
        context.user.id,
      );
      if (
        current.user.mustChangePassword ||
        !['ADMIN', 'WAREHOUSE_KEEPER', 'EMPLOYEE'].includes(current.user.role)
      )
        throw new ForbiddenException('Warehouse access required');
      const actor = await this.audit.actor(transaction, current.user.id);
      const merchant = await this.lockMerchant(transaction, input.merchantId);
      if (!merchant.is_active)
        throw new BadRequestException('Merchant is inactive');
      const identity = await this.codes.allocate(
        transaction,
        input.merchantId,
        merchant.code,
      );
      const item = await transaction.item.create({
        data: {
          merchantId: input.merchantId,
          ...identity,
          name: input.name,
          brand: input.brand,
          color: input.color,
          weightKg: input.weightKg,
          notes: input.notes ?? null,
          createdById: current.user.id,
        },
        select: itemSelection,
      });
      await this.audit.append(
        transaction,
        actor,
        'ITEM',
        'CREATE',
        null,
        item,
        null,
      );
      return presentItem(item);
    });
  }
  async list(context: AuthenticationContext, query: ListItemsDto) {
    const where: Prisma.ItemWhereInput = {
      ...this.scope(context, query.merchantId),
      ...(query.isActive !== undefined ? { isActive: query.isActive } : {}),
      ...(query.search
        ? {
            OR: ['code', 'name', 'brand', 'color'].map((field) => ({
              [field]: { contains: query.search, mode: 'insensitive' },
            })),
          }
        : {}),
    };
    const [items, total] = await this.database.$transaction(
      [
        this.database.item.findMany({
          where,
          select: itemSelection,
          skip: (query.page - 1) * query.limit,
          take: query.limit,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        }),
        this.database.item.count({ where }),
      ],
      { isolationLevel: 'RepeatableRead' },
    );
    return {
      items: items.map(presentItem),
      total,
      page: query.page,
      limit: query.limit,
    };
  }
  async get(context: AuthenticationContext, id: string) {
    return presentItem(await this.find(context, { id }));
  }
  async byCode(context: AuthenticationContext, code: string) {
    const normalized = code.trim().toUpperCase();
    if (!/^[A-Z]{2,8}-[0-9]{6,19}$/.test(normalized))
      throw new BadRequestException('Invalid item code');
    return presentItem(await this.find(context, { code: normalized }));
  }
  async label(context: AuthenticationContext, id: string) {
    const item = await this.database.item.findFirst({
      where: { id, ...this.scope(context) },
      select: {
        code: true,
        name: true,
        merchant: { select: { code: true, name: true } },
      },
    });
    if (!item) throw new NotFoundException('Item not found');
    return {
      code: item.code,
      symbology: 'CODE128' as const,
      itemName: item.name,
      merchantName: item.merchant.name,
      merchantCode: item.merchant.code,
    };
  }
  async update(
    context: AuthenticationContext,
    id: string,
    input: UpdateItemDto,
  ) {
    if (
      !Object.entries(input).some(
        ([key, value]) => key !== 'reason' && value !== undefined,
      )
    )
      throw new BadRequestException('At least one field is required');
    return this.mutate(
      context,
      id,
      {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.brand !== undefined ? { brand: input.brand } : {}),
        ...(input.color !== undefined ? { color: input.color } : {}),
        ...(input.weightKg !== undefined ? { weightKg: input.weightKg } : {}),
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
      },
      input.reason,
      'UPDATE',
    );
  }
  async setStatus(
    context: AuthenticationContext,
    id: string,
    isActive: boolean,
    reason: string,
  ) {
    return this.mutate(context, id, { isActive }, reason, 'STATUS');
  }
  private async mutate(
    context: AuthenticationContext,
    id: string,
    data: Prisma.ItemUpdateInput,
    reason: string,
    action: 'UPDATE' | 'STATUS',
  ) {
    return this.mutations.run(context, [], async (transaction) => {
      const item = await transaction.item.findUnique({
        where: { id },
        select: { merchantId: true },
      });
      if (!item) throw new NotFoundException('Item not found');
      await this.lockMerchant(transaction, item.merchantId);
      await transaction.$queryRaw`SELECT id FROM items WHERE id = ${id}::uuid FOR UPDATE`;
      const before = await transaction.item.findUniqueOrThrow({
        where: { id },
        select: itemSelection,
      });
      const actor = await this.audit.actor(transaction, context.user.id);
      const after = await transaction.item.update({
        where: { id },
        data,
        select: itemSelection,
      });
      await this.audit.append(
        transaction,
        actor,
        'ITEM',
        action,
        before,
        after,
        reason,
      );
      return presentItem(after);
    });
  }
  private scope(
    context: AuthenticationContext,
    requestedMerchantId?: string,
  ): Prisma.ItemWhereInput {
    const normalized = requestedMerchantId?.toLowerCase();
    if (context.user.role === 'MERCHANT') {
      const merchantId = context.user.merchantId;
      if (!merchantId || (normalized && normalized !== merchantId))
        throw new ForbiddenException('Access denied');
      return { merchantId };
    }
    return normalized ? { merchantId: normalized } : {};
  }
  private async find(
    context: AuthenticationContext,
    where: Prisma.ItemWhereInput,
  ) {
    const item = await this.database.item.findFirst({
      where: { ...where, ...this.scope(context) },
      select: itemSelection,
    });
    if (!item) throw new NotFoundException('Item not found');
    return item;
  }
  private async lockMerchant(
    transaction: Prisma.TransactionClient,
    id: string,
  ) {
    const [merchant] = await transaction.$queryRaw<
      { id: string; code: string; is_active: boolean }[]
    >`
   SELECT id, code, is_active FROM merchants WHERE id = ${id}::uuid FOR SHARE`;
    if (!merchant) throw new NotFoundException('Merchant not found');
    return merchant;
  }
}
