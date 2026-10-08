import { Injectable, Logger } from '@nestjs/common';
@Injectable()
export class SecurityAuditService {
  private readonly logger = new Logger('SecurityAudit');
  record(
    event:
      | 'login.success'
      | 'login.failure'
      | 'login.limited'
      | 'password.changed'
      | 'session.logout'
      | 'admin.bootstrap',
    userId?: string,
  ): void {
    this.logger.log(JSON.stringify({ event, ...(userId ? { userId } : {}) }));
  }
  recordAdministration(
    event:
      | 'user.created'
      | 'user.updated'
      | 'user.role_changed'
      | 'user.enabled'
      | 'user.disabled'
      | 'merchant.created'
      | 'merchant.updated'
      | 'merchant.enabled'
      | 'merchant.disabled',
    actorId: string,
    targetId: string,
  ): void {
    this.logger.log(JSON.stringify({ event, actorId, targetId }));
  }
}
