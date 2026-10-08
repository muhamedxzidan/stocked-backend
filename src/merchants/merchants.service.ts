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
import { SecurityAuditService } from '../auth/security-audit.service.js';
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
    @Inject(SecurityAuditService) private readonly audit: SecurityAuditService,
  ) {}

  async create(context: AuthenticationContext, input: CreateMerchantDto) {
    const merchant = await this.mutations.run(context, [], (transaction) =>
      transaction.merchant.create({
        data: {
          code: input.code.trim().toUpperCase(),
          name: input.name.trim(),
          phone: input.phone.trim(),
          createdById: context.user.id,
        },
        select: merchantSelection,
      }),
    );
    this.audit.recordAdministration(
      'merchant.created',
      context.user.id,
      merchant.id,
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
    if (!Object.values(input).some((value) => value !== undefined))
      throw new BadRequestException('At least one field is required');
    const merchant = await this.mutations.run(
      context,
      [],
      async (transaction) => {
        if (
          !(await transaction.merchant.findUnique({
            where: { id },
            select: { id: true },
          }))
        )
          throw new NotFoundException('Merchant not found');
        return transaction.merchant.update({
          where: { id },
          data: {
            ...(input.name !== undefined ? { name: input.name.trim() } : {}),
            ...(input.phone !== undefined ? { phone: input.phone.trim() } : {}),
          },
          select: merchantSelection,
        });
      },
    );
    this.audit.recordAdministration('merchant.updated', context.user.id, id);
    return merchant;
  }

  async setStatus(
    context: AuthenticationContext,
    id: string,
    isActive: boolean,
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
        if (
          !(await transaction.merchant.findUnique({
            where: { id },
            select: { id: true },
          }))
        )
          throw new NotFoundException('Merchant not found');
        const updated = await transaction.merchant.update({
          where: { id },
          data: { isActive },
          select: merchantSelection,
        });
        if (!isActive)
          await this.sessions.revokeForUsers(transaction, accountIds);
        return updated;
      },
    );
    this.audit.recordAdministration(
      isActive ? 'merchant.enabled' : 'merchant.disabled',
      context.user.id,
      id,
    );
    return merchant;
  }
}
