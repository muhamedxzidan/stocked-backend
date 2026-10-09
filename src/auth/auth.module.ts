import { OperationControlModule } from '../operation-control/operation-control.module.js';
import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { PrismaModule } from '../database/prisma.module.js';
import { AdminMutationService } from './admin-mutation.service.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { SessionService } from './session.service.js';
import { PasswordService } from './password.service.js';
import { LoginAttemptsService } from './login-attempts.service.js';
import { SecurityAuditService } from './security-audit.service.js';
import { SessionGuard } from './guards/session.guard.js';
import { PasswordChangeGuard } from './guards/password-change.guard.js';
import { RolesGuard } from './guards/roles.guard.js';
import { LoginAttemptsGuard } from './guards/login-attempts.guard.js';
@Module({
  imports: [OperationControlModule, PrismaModule],
  controllers: [AuthController],
  providers: [
    AdminMutationService,
    AuthService,
    SessionService,
    PasswordService,
    LoginAttemptsService,
    SecurityAuditService,
    LoginAttemptsGuard,
    { provide: APP_GUARD, useClass: SessionGuard },
    { provide: APP_GUARD, useClass: PasswordChangeGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
  exports: [
    PasswordService,
    SecurityAuditService,
    SessionService,
    AdminMutationService,
  ],
})
export class AuthModule {}
