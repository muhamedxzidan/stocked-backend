import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '../../generated/prisma/client.js';
import {
  PUBLIC_ROUTE,
  AUTHENTICATED_ROUTE,
  ROUTE_ROLES,
} from '../decorators/access.js';
import type { AuthenticatedRequest } from '../authenticated-user.js';
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(@Inject(Reflector) private readonly reflector: Reflector) {}
  canActivate(context: ExecutionContext): boolean {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(PUBLIC_ROUTE, targets))
      return true;
    const user = context.switchToHttp().getRequest<AuthenticatedRequest>()
      .authentication?.user;
    const roles = this.reflector.getAllAndOverride<UserRole[]>(
      ROUTE_ROLES,
      targets,
    );
    if (roles !== undefined) {
      if (
        user &&
        roles.length > 0 &&
        roles.every((role) => Object.values(UserRole).includes(role)) &&
        roles.includes(user.role)
      )
        return true;
    } else if (
      user &&
      this.reflector.getAllAndOverride<boolean>(AUTHENTICATED_ROUTE, targets)
    )
      return true;
    throw new ForbiddenException('Access denied');
  }
}
