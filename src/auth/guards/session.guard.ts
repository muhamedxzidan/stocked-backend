import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { SessionService } from '../session.service.js';
import { PUBLIC_ROUTE } from '../decorators/access.js';
import type { AuthenticatedRequest } from '../authenticated-user.js';
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(SessionService) private readonly sessions: SessionService,
  ) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (
      this.reflector.getAllAndOverride<boolean>(PUBLIC_ROUTE, [
        context.getHandler(),
        context.getClass(),
      ])
    )
      return true;
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const header = request.headers.authorization;
    if (!header || !/^Bearer [A-Za-z0-9_-]{43}$/i.test(header))
      throw new UnauthorizedException('Authentication required');
    request.authentication = await this.sessions.authenticate(header.slice(7));
    return true;
  }
}
