import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
} from '@nestjs/common';
import type { Response } from 'express';
import { LoginAttemptsService } from '../login-attempts.service.js';
import { SecurityAuditService } from '../security-audit.service.js';
import type { AuthenticatedRequest } from '../authenticated-user.js';
@Injectable()
export class LoginAttemptsGuard implements CanActivate {
  constructor(
    @Inject(LoginAttemptsService)
    private readonly attempts: LoginAttemptsService,
    @Inject(SecurityAuditService) private readonly audit: SecurityAuditService,
  ) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const body = request.body as { email?: unknown } | undefined;
    const email =
      request.authentication?.user.email ??
      (typeof body?.email === 'string' && body.email.length <= 512
        ? body.email
        : '<invalid>');
    const result = await this.attempts.consume(
      email,
      request.ip ?? request.socket.remoteAddress ?? '<unknown>',
    );
    if (result.retryAfter) {
      context
        .switchToHttp()
        .getResponse<Response>()
        .setHeader('Retry-After', result.retryAfter);
      this.audit.record('login.limited');
      throw new HttpException(
        'Too many authentication attempts',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return true;
  }
}
