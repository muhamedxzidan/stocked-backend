import {
  createParamDecorator,
  SetMetadata,
  UnauthorizedException,
  type ExecutionContext,
} from '@nestjs/common';
import type { UserRole } from '../../generated/prisma/client.js';
import type { AuthenticatedRequest } from '../authenticated-user.js';
export const PUBLIC_ROUTE = 'stocked.public';
export const AUTHENTICATED_ROUTE = 'stocked.authenticated';
export const ROUTE_ROLES = 'stocked.roles';
export const LIMITED_SESSION_ROUTE = 'stocked.limited-session';
export const Public = () => SetMetadata(PUBLIC_ROUTE, true);
export const Authenticated = () => SetMetadata(AUTHENTICATED_ROUTE, true);
export const Roles = (...roles: UserRole[]) => SetMetadata(ROUTE_ROLES, roles);
export const AllowPasswordChangeSession = () =>
  SetMetadata(LIMITED_SESSION_ROUTE, true);
export const CurrentAuthentication = createParamDecorator(
  (_data: unknown, context: ExecutionContext) => {
    const authentication = context
      .switchToHttp()
      .getRequest<AuthenticatedRequest>().authentication;
    if (!authentication)
      throw new UnauthorizedException('Authentication required');
    return authentication;
  },
);
