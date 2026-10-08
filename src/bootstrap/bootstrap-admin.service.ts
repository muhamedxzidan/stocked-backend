import {
  ConflictException,
  Inject,
  Injectable,
  BadRequestException,
} from '@nestjs/common';
import { isEmail } from 'class-validator';
import { PrismaService } from '../database/prisma.service.js';
import { PasswordService } from '../auth/password.service.js';
import { SecurityAuditService } from '../auth/security-audit.service.js';
@Injectable()
export class BootstrapAdminService {
  constructor(
    @Inject(PrismaService) private readonly database: PrismaService,
    @Inject(PasswordService) private readonly passwords: PasswordService,
    @Inject(SecurityAuditService) private readonly audit: SecurityAuditService,
  ) {}
  async create(
    email: string,
    displayName: string,
    password: string,
  ): Promise<void> {
    email = email.trim().toLowerCase();
    displayName = displayName.trim();
    if (
      email.length > 254 ||
      !isEmail(email) ||
      !displayName ||
      displayName.length > 150
    )
      throw new BadRequestException('Invalid email or display name');
    const passwordHash = await this.passwords.hash(password);
    const user = await this.database.$transaction(async (transaction) => {
      await transaction.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(847312, 1)`;
      if (await transaction.user.count())
        throw new ConflictException('Admin bootstrap is already complete');
      return transaction.user.create({
        data: {
          email,
          displayName,
          passwordHash,
          role: 'ADMIN',
          mustChangePassword: true,
        },
      });
    });
    this.audit.record('admin.bootstrap', user.id);
  }
}
