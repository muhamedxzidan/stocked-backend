import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../database/prisma.service.js';
import { AdminMutationService } from '../auth/admin-mutation.service.js';
import { SessionService } from '../auth/session.service.js';
import { AuditEventWriter } from '../audit-events/audit-event-writer.js';
import type { AuthenticationContext } from '../auth/authenticated-user.js';
import type { CreateMerchantDto } from './dto/create-merchant.dto.js';
import type { UpdateMerchantDto } from './dto/update-merchant.dto.js';
import type { ListMerchantsDto } from './dto/list-merchants.dto.js';
import { merchantSelection } from './merchant-selection.js';

@Injectable()
export class MerchantsService {
  constructor(
    @Inject(PrismaService) private readonly database: PrismaService,
    @Inject(AdminMutationService)
    private readonly mutations: AdminMutationService,
    @Inject(SessionService) private readonly sessions: SessionService,
    @Inject(AuditEventWriter) private readonly audit: AuditEventWriter,
  ) {}

  async create(context: AuthenticationContext, input: CreateMerchantDto) {
    const merchant = await this.mutations.run(
      context,
      [],
      async (transaction) => {
        const actor = await this.audit.actor(transaction, context.user.id);
        const created = await transaction.merchant.create({
          data: {
            code: input.code.trim().toUpperCase(),
            name: input.name.trim(),
            phone: input.phone.trim(),
            createdById: context.user.id,
          },
          select: merchantSelection,
        });
        await this.audit.append(
          transaction,
          actor,
          'MERCHANT',
          'CREATE',
          null,
          created,
          null,
        );
        return created;
      },
    );
    return merchant;
  }

  async list(query: ListMerchantsDto) {
    const where: Prisma.MerchantWhereInput = {
      ...(query.isActive !== undefined ? { isActive: query.isActive } : {}),
      ...(query.search
        ? {
            OR: [
              { code: { contains: query.search, mode: 'insensitive' } },
              { name: { contains: query.search, mode: 'insensitive' } },
              { phone: { contains: query.search } },
            ],
          }
        : {}),
    };
    const [items, total] = await this.database.$transaction(
      [
        this.database.merchant.findMany({
          where,
          select: merchantSelection,
          skip: (query.page - 1) * query.limit,
          take: query.limit,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        }),
        this.database.merchant.count({ where }),
      ],
      { isolationLevel: 'RepeatableRead' },
    );
    return { items, total, page: query.page, limit: query.limit };
  }

  async get(id: string) {
    const merchant = await this.database.merchant.findUnique({
      where: { id },
      select: merchantSelection,
    });
    if (!merchant) throw new NotFoundException('Merchant not found');
    return merchant;
  }

  async update(
    context: AuthenticationContext,
    id: string,
    input: UpdateMerchantDto,
  ) {
    if (
      !Object.entries(input).some(
        ([key, value]) => key !== 'reason' && value !== undefined,
      )
    )
      throw new BadRequestException('At least one field is required');
    const merchant = await this.mutations.run(
      context,
      [],
      async (transaction) => {
        const current = await transaction.merchant.findUnique({
          where: { id },
          select: merchantSelection,
        });
        if (!current) throw new NotFoundException('Merchant not found');
        const actor = await this.audit.actor(transaction, context.user.id);
        const updated = await transaction.merchant.update({
          where: { id },
          data: {
            ...(input.name !== undefined ? { name: input.name.trim() } : {}),
            ...(input.phone !== undefined ? { phone: input.phone.trim() } : {}),
          },
          select: merchantSelection,
        });
        await this.audit.append(
          transaction,
          actor,
          'MERCHANT',
          'UPDATE',
          current,
          updated,
          input.reason,
        );
        return updated;
      },
    );
    return merchant;
  }

  async setStatus(
    context: AuthenticationContext,
    id: string,
    isActive: boolean,
    reason: string,
  ) {
    // Resolve membership only after the global administration lock has been taken.
    let accountIds: string[] = [];
    const merchant = await this.mutations.run(
      context,
      async (transaction) => {
        accountIds = (
          await transaction.user.findMany({
            where: { merchantId: id },
            select: { id: true },
          })
        ).map((user) => user.id);
        return accountIds;
      },
      async (transaction) => {
        const current = await transaction.merchant.findUnique({
          where: { id },
          select: merchantSelection,
        });
        if (!current) throw new NotFoundException('Merchant not found');
        const actor = await this.audit.actor(transaction, context.user.id);
        const updated = await transaction.merchant.update({
          where: { id },
          data: { isActive },
          select: merchantSelection,
        });
        if (!isActive)
          await this.sessions.revokeForUsers(transaction, accountIds);
        await this.audit.append(
          transaction,
          actor,
          'MERCHANT',
          'STATUS',
          current,
          updated,
          reason,
        );
        return updated;
      },
    );
    return merchant;
  }
}
