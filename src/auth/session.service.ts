import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { PrismaService } from '../database/prisma.service.js';
import { Environment } from '../config/environment.js';
import type { Prisma, User } from '../generated/prisma/client.js';
import type {
  AuthenticatedUser,
  AuthenticationContext,
} from './authenticated-user.js';

export function presentUser(user: User): AuthenticatedUser {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    role: user.role,
    merchantId: user.merchantId,
    mustChangePassword: user.mustChangePassword,
  };
}

@Injectable()
export class SessionService {
  constructor(
    @Inject(PrismaService) private readonly database: PrismaService,
    @Inject(Environment) private readonly environment: Environment,
  ) {}

  // All session/password mutations for one account acquire the same user row lock.
  async lockUser(
    transaction: Prisma.TransactionClient,
    userId: string,
  ): Promise<void> {
    await transaction.$queryRaw`SELECT id FROM users WHERE id = ${userId}::uuid FOR UPDATE`;
  }
  async create(transaction: Prisma.TransactionClient, userId: string) {
    const token = randomBytes(32).toString('base64url');
    const now = await this.database.time(transaction);
    const expiresAt = new Date(
      now.getTime() + this.environment.sessionLifetimeMs,
    );
    await transaction.session.create({
      data: {
        userId,
        tokenHash: this.digest(token),
        createdAt: now,
        lastSeenAt: now,
        expiresAt,
      },
    });
    return { token, tokenType: 'Bearer' as const, expiresAt };
  }
  async authenticate(token: string): Promise<AuthenticationContext> {
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw this.invalid();
    return this.database.$transaction(async (transaction) => {
      const session = await transaction.session.findUnique({
        where: { tokenHash: this.digest(token) },
        select: { id: true, userId: true },
      });
      if (!session) throw this.invalid();
      await this.lockUser(transaction, session.userId);
      const context = await this.validate(
        transaction,
        session.id,
        session.userId,
      );
      const now = await this.database.time(transaction);
      await transaction.session.update({
        where: { id: session.id },
        data: { lastSeenAt: now },
      });
      return context;
    });
  }
  // Call only after lockUser in this transaction; used to recheck sensitive mutations.
  async validate(
    transaction: Prisma.TransactionClient,
    sessionId: string,
    userId: string,
  ): Promise<AuthenticationContext> {
    const session = await transaction.session.findUnique({
      where: { id: sessionId },
      include: { user: { include: { merchant: true } } },
    });
    const now = await this.database.time(transaction);
    if (
      !session ||
      session.userId !== userId ||
      session.revokedAt ||
      session.expiresAt <= now ||
      session.lastSeenAt.getTime() + this.environment.sessionIdleMs <=
        now.getTime() ||
      !session.user.isActive ||
      (session.user.role === 'MERCHANT' && !session.user.merchant?.isActive)
    )
      throw this.invalid();
    return { user: presentUser(session.user), sessionId: session.id };
  }
  // Caller holds the affected user row locks; revocation participates in its transaction.
  async revokeForUsers(
    transaction: Prisma.TransactionClient,
    userIds: readonly string[],
  ): Promise<void> {
    if (userIds.length === 0) return;
    await transaction.session.updateMany({
      where: { userId: { in: [...userIds] }, revokedAt: null },
      data: { revokedAt: await this.database.time(transaction) },
    });
  }
  async logout(context: AuthenticationContext): Promise<void> {
    await this.database.$transaction(async (transaction) => {
      await this.lockUser(transaction, context.user.id);
      await this.validate(transaction, context.sessionId, context.user.id);
      await transaction.session.update({
        where: { id: context.sessionId },
        data: { revokedAt: await this.database.time(transaction) },
      });
    });
  }
  private digest(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
  private invalid(): UnauthorizedException {
    return new UnauthorizedException('Invalid or expired session');
  }
}
