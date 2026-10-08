import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma, UserRole } from '../generated/prisma/client.js';
import { PrismaService } from '../database/prisma.service.js';
import { AdminMutationService } from '../auth/admin-mutation.service.js';
import { PasswordService } from '../auth/password.service.js';
import { SessionService } from '../auth/session.service.js';
import { SecurityAuditService } from '../auth/security-audit.service.js';
import type { AuthenticationContext } from '../auth/authenticated-user.js';
import type { CreateUserDto } from './dto/create-user.dto.js';
import type { UpdateUserDto } from './dto/update-user.dto.js';
import type { ListUsersDto } from './dto/list-users.dto.js';
import { userSelection } from './user-selection.js';

@Injectable()
export class UsersService {
  constructor(
    @Inject(PrismaService) private readonly database: PrismaService,
    @Inject(AdminMutationService)
    private readonly mutations: AdminMutationService,
    @Inject(PasswordService) private readonly passwords: PasswordService,
    @Inject(SessionService) private readonly sessions: SessionService,
    @Inject(SecurityAuditService) private readonly audit: SecurityAuditService,
  ) {}

  async create(context: AuthenticationContext, input: CreateUserDto) {
    const passwordHash = await this.passwords.hash(input.initialPassword);
    const user = await this.mutations.run(context, [], async (transaction) => {
      const merchantId = input.merchantId ?? null;
      await this.validateMerchant(transaction, input.role, merchantId);
      return transaction.user.create({
        data: {
          email: input.email.trim().toLowerCase(),
          displayName: input.displayName.trim(),
          passwordHash,
          role: input.role,
          merchantId,
          createdById: context.user.id,
          mustChangePassword: true,
        },
        select: userSelection,
      });
    });
    this.audit.recordAdministration('user.created', context.user.id, user.id);
    return user;
  }

  async list(query: ListUsersDto) {
    const where: Prisma.UserWhereInput = {
      ...(query.role !== undefined ? { role: query.role } : {}),
      ...(query.isActive !== undefined ? { isActive: query.isActive } : {}),
      ...(query.merchantId !== undefined
        ? { merchantId: query.merchantId }
        : {}),
      ...(query.search
        ? {
            OR: [
              { email: { contains: query.search, mode: 'insensitive' } },
              { displayName: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [items, total] = await this.database.$transaction(
      [
        this.database.user.findMany({
          where,
          select: userSelection,
          skip: (query.page - 1) * query.limit,
          take: query.limit,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        }),
        this.database.user.count({ where }),
      ],
      { isolationLevel: 'RepeatableRead' },
    );
    return { items, total, page: query.page, limit: query.limit };
  }

  async get(id: string) {
    const user = await this.database.user.findUnique({
      where: { id },
      select: userSelection,
    });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async update(
    context: AuthenticationContext,
    id: string,
    input: UpdateUserDto,
  ) {
    if (!Object.values(input).some((value) => value !== undefined))
      throw new BadRequestException('At least one field is required');
    const result = await this.mutations.run(
      context,
      [id],
      async (transaction) => {
        const current = await transaction.user.findUnique({
          where: { id },
          select: userSelection,
        });
        if (!current) throw new NotFoundException('User not found');
        const role = input.role ?? current.role;
        const merchantId =
          input.merchantId === undefined
            ? current.merchantId
            : input.merchantId;
        const email =
          input.email === undefined
            ? current.email
            : input.email.trim().toLowerCase();
        if (
          current.role === 'MERCHANT' &&
          role !== 'MERCHANT' &&
          input.merchantId !== null
        ) {
          throw new BadRequestException(
            'Set merchantId to null when leaving the merchant role',
          );
        }
        if (role !== current.role || merchantId !== current.merchantId)
          await this.validateMerchant(transaction, role, merchantId);
        await this.protectLastAdmin(
          transaction,
          current,
          role,
          current.isActive,
        );
        const user = await transaction.user.update({
          where: { id },
          data: {
            email,
            role,
            merchantId,
            ...(input.displayName !== undefined
              ? { displayName: input.displayName.trim() }
              : {}),
          },
          select: userSelection,
        });
        if (
          email !== current.email ||
          role !== current.role ||
          merchantId !== current.merchantId
        )
          await this.sessions.revokeForUsers(transaction, [id]);
        return { user, roleChanged: role !== current.role };
      },
    );
    this.audit.recordAdministration(
      result.roleChanged ? 'user.role_changed' : 'user.updated',
      context.user.id,
      id,
    );
    return result.user;
  }

  async setStatus(
    context: AuthenticationContext,
    id: string,
    isActive: boolean,
  ) {
    const user = await this.mutations.run(
      context,
      [id],
      async (transaction) => {
        const current = await transaction.user.findUnique({
          where: { id },
          select: userSelection,
        });
        if (!current) throw new NotFoundException('User not found');
        await this.protectLastAdmin(
          transaction,
          current,
          current.role,
          isActive,
        );
        const updated = await transaction.user.update({
          where: { id },
          data: { isActive },
          select: userSelection,
        });
        if (!isActive) await this.sessions.revokeForUsers(transaction, [id]);
        return updated;
      },
    );
    this.audit.recordAdministration(
      isActive ? 'user.enabled' : 'user.disabled',
      context.user.id,
      id,
    );
    return user;
  }

  private async validateMerchant(
    transaction: Prisma.TransactionClient,
    role: UserRole,
    merchantId: string | null,
  ): Promise<void> {
    if (role !== 'MERCHANT') {
      if (merchantId !== null)
        throw new BadRequestException(
          'Only merchant accounts may have a merchantId',
        );
      return;
    }
    if (!merchantId)
      throw new BadRequestException('Merchant accounts require merchantId');
    const merchant = await transaction.merchant.findUnique({
      where: { id: merchantId },
      select: { isActive: true },
    });
    if (!merchant) throw new NotFoundException('Merchant not found');
    if (!merchant.isActive)
      throw new ConflictException(
        'Cannot link an account to an inactive merchant',
      );
  }

  private async protectLastAdmin(
    transaction: Prisma.TransactionClient,
    current: { role: UserRole; isActive: boolean },
    nextRole: UserRole,
    nextActive: boolean,
  ): Promise<void> {
    if (
      current.role === 'ADMIN' &&
      current.isActive &&
      (nextRole !== 'ADMIN' || !nextActive)
    ) {
      const remaining = await transaction.user.count({
        where: { role: 'ADMIN', isActive: true },
      });
      if (remaining <= 1)
        throw new ConflictException(
          'At least one active administrator must remain',
        );
    }
  }
}
