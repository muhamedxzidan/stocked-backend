import type { Request } from 'express';
import type { UserRole } from '../generated/prisma/client.js';
export interface AuthenticatedUser {
  readonly id: string;
  readonly email: string;
  readonly displayName: string;
  readonly role: UserRole;
  readonly merchantId: string | null;
  readonly mustChangePassword: boolean;
}
export interface AuthenticationContext {
  readonly user: AuthenticatedUser;
  readonly sessionId: string;
}
export interface AuthenticatedRequest extends Request {
  authentication?: AuthenticationContext;
}
