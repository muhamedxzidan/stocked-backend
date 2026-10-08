import {
  Inject,
  Injectable,
  UnauthorizedException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { PasswordService } from './password.service.js';
import { SessionService, presentUser } from './session.service.js';
import { SecurityAuditService } from './security-audit.service.js';
import type { AuthenticationContext } from './authenticated-user.js';
import type { LoginDto } from './dto/login.dto.js';
import type { ChangePasswordDto } from './dto/change-password.dto.js';

@Injectable()
export class AuthService {
  constructor(
    @Inject(PrismaService) private readonly database: PrismaService,
    @Inject(PasswordService) private readonly passwords: PasswordService,
    @Inject(SessionService) private readonly sessions: SessionService,
    @Inject(SecurityAuditService) private readonly audit: SecurityAuditService,
  ) {}
  async login(input: LoginDto) {
    const email = input.email.trim().toLowerCase();
    const candidate = await this.database.user.findUnique({ where: { email } });
    const valid = await this.passwords.verify(
      input.password,
      candidate?.passwordHash,
    );
    if (!candidate || !valid) {
      this.audit.record('login.failure');
      throw this.failedLogin();
    }
    const result = await this.database.$transaction(async (transaction) => {
      await this.sessions.lockUser(transaction, candidate.id);
      const current = await transaction.user.findUnique({
        where: { id: candidate.id },
        include: { merchant: true },
      });
      // A concurrent password change must invalidate verification of the old hash.
      if (
        !current ||
        !current.isActive ||
        current.email !== email ||
        current.passwordHash !== candidate.passwordHash ||
        (current.role === 'MERCHANT' && !current.merchant?.isActive)
      ) {
        this.audit.record('login.failure');
        throw this.failedLogin();
      }
      return {
        ...(await this.sessions.create(transaction, current.id)),
        user: presentUser(current),
      };
    });
    this.audit.record('login.success', candidate.id);
    return result;
  }
  async changePassword(
    context: AuthenticationContext,
    input: ChangePasswordDto,
  ) {
    this.passwords.validate(input.newPassword);
    if (input.newPassword === input.currentPassword)
      throw new BadRequestException('Choose a different password');
    const candidate = await this.database.user.findUnique({
      where: { id: context.user.id },
    });
    const valid = await this.passwords.verify(
      input.currentPassword,
      candidate?.passwordHash,
    );
    if (!candidate || !valid)
      throw new UnauthorizedException('Current password is incorrect');
    const hash = await this.passwords.hash(input.newPassword);
    const result = await this.database.$transaction(async (transaction) => {
      await this.sessions.lockUser(transaction, candidate.id);
      await this.sessions.validate(
        transaction,
        context.sessionId,
        candidate.id,
      );
      const current = await transaction.user.findUnique({
        where: { id: candidate.id },
      });
      if (!current || current.passwordHash !== candidate.passwordHash)
        throw new UnauthorizedException('Please sign in again');
      const now = await this.database.time(transaction);
      const user = await transaction.user.update({
        where: { id: candidate.id },
        data: { passwordHash: hash, mustChangePassword: false },
      });
      await transaction.session.updateMany({
        where: { userId: candidate.id, revokedAt: null },
        data: { revokedAt: now },
      });
      return {
        ...(await this.sessions.create(transaction, candidate.id)),
        user: presentUser(user),
      };
    });
    this.audit.record('password.changed', candidate.id);
    return result;
  }
  async logout(context: AuthenticationContext): Promise<void> {
    await this.sessions.logout(context);
    this.audit.record('session.logout', context.user.id);
  }
  private failedLogin(): UnauthorizedException {
    return new UnauthorizedException('Invalid email or password');
  }
}
