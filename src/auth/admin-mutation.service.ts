import { ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import type { Prisma } from '../generated/prisma/client.js';
import type { AuthenticationContext } from './authenticated-user.js';
import { SessionService } from './session.service.js';

type AffectedUsers =
  | readonly string[]
  | ((transaction: Prisma.TransactionClient) => Promise<string[]>);

@Injectable()
export class AdminMutationService {
  constructor(
    @Inject(PrismaService) private readonly database: PrismaService,
    @Inject(SessionService) private readonly sessions: SessionService,
  ) {}

  async run<T>(
    context: AuthenticationContext,
    affectedUsers: AffectedUsers,
    operation: (transaction: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    return this.database.$transaction(async (transaction) => {
      // All identity administration writes serialize here, before any user locks.
      await transaction.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(847312, 2)`;
      const targets =
        typeof affectedUsers === 'function'
          ? await affectedUsers(transaction)
          : affectedUsers;
      const ids = [...new Set([context.user.id, ...targets])].sort((a, b) =>
        a.localeCompare(b),
      );
      for (const id of ids) await this.sessions.lockUser(transaction, id);
      const current = await this.sessions.validate(
        transaction,
        context.sessionId,
        context.user.id,
      );
      if (current.user.role !== 'ADMIN' || current.user.mustChangePassword)
        throw new ForbiddenException('Administrator access required');
      return operation(transaction);
    });
  }
}
