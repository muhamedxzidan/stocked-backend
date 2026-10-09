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
}
