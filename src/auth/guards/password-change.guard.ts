import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { LIMITED_SESSION_ROUTE } from '../decorators/access.js';
import type { AuthenticatedRequest } from '../authenticated-user.js';
@Injectable()
export class PasswordChangeGuard implements CanActivate {
  constructor(@Inject(Reflector) private readonly reflector: Reflector) {}
  canActivate(context: ExecutionContext): boolean {
    const user = context.switchToHttp().getRequest<AuthenticatedRequest>()
      .authentication?.user;
    if (
      user?.mustChangePassword &&
      !this.reflector.getAllAndOverride<boolean>(LIMITED_SESSION_ROUTE, [
        context.getHandler(),
        context.getClass(),
      ])
    ) {
      throw new ForbiddenException('Password change required');
    }
    return true;
  }
}
