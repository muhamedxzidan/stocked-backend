import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import type { Prisma } from '../generated/prisma/client.js';
import type { AuthenticationContext } from '../auth/authenticated-user.js';
import type { AuditEventsQueryDto } from './dto/audit-events-query.dto.js';
@Injectable()
export class AuditEventsReadService {
  constructor(
    @Inject(PrismaService) private readonly database: PrismaService,
  ) {}
  async list(context: AuthenticationContext, query: AuditEventsQueryDto) {
    this.authorize(context);
    if (query.from && query.to && new Date(query.from) >= new Date(query.to))
      throw new BadRequestException('from must be earlier than to');
    const where: Prisma.AuditEventWhereInput = {
      ...(query.entityType ? { entityType: query.entityType } : {}),
      ...(query.entityId ? { entityId: query.entityId } : {}),
      ...(query.actorId ? { actorId: query.actorId } : {}),
      ...(query.action ? { action: query.action } : {}),
      ...(query.from || query.to
        ? {
            recordedAt: {
              ...(query.from ? { gte: new Date(query.from) } : {}),
              ...(query.to ? { lt: new Date(query.to) } : {}),
            },
          }
        : {}),
    };
    const [items, total] = await this.database.$transaction(
      [
        this.database.auditEvent.findMany({
          where,
          skip: (query.page - 1) * query.limit,
          take: query.limit,
          orderBy: [{ recordedAt: 'desc' }, { id: 'desc' }],
        }),
        this.database.auditEvent.count({ where }),
      ],
      { isolationLevel: 'RepeatableRead' },
    );
    return { items, total, page: query.page, limit: query.limit };
  }
  async get(context: AuthenticationContext, id: string) {
    this.authorize(context);
    const event = await this.database.auditEvent.findUnique({ where: { id } });
    if (!event) throw new NotFoundException('Audit event not found');
    return event;
  }
  private authorize(context: AuthenticationContext) {
    if (context.user.role !== 'ADMIN' || context.user.mustChangePassword)
      throw new ForbiddenException('Administrator access required');
  }
}
