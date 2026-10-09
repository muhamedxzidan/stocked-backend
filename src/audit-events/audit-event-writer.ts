import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  Prisma,
  type AuditEntityType,
  type AuditAction,
  type UserRole,
} from '../generated/prisma/client.js';
import { PrismaService } from '../database/prisma.service.js';

type AuditActor = Readonly<{ id: string; displayName: string; role: UserRole }>;
const fields: Record<AuditEntityType, readonly string[]> = {
  ITEM: [
    'id',
    'merchantId',
    'code',
    'name',
    'brand',
    'color',
    'weightKg',
    'notes',
    'isActive',
  ],
  ROW: ['id', 'warehouseId', 'code', 'name', 'isActive'],
  SHELF: [
    'id',
    'warehouseId',
    'rowId',
    'merchantId',
    'code',
    'name',
    'isActive',
  ],
  USER: [
    'id',
    'email',
    'displayName',
    'role',
    'merchantId',
    'isActive',
    'mustChangePassword',
  ],
  MERCHANT: ['id', 'code', 'name', 'phone', 'isActive'],
};

@Injectable()
export class AuditEventWriter {
  constructor(
    @Inject(PrismaService) private readonly database: PrismaService,
  ) {}
  // Caller already holds the actor lock and has revalidated the session.
  // Capture before a self-directed administrative change alters name or role.
  async actor(tx: Prisma.TransactionClient, id: string): Promise<AuditActor> {
    const actor = await tx.user.findUnique({
      where: { id },
      select: { id: true, displayName: true, role: true },
    });
    if (!actor) throw new NotFoundException('Audit actor not found');
    return actor;
  }
  async append(
    tx: Prisma.TransactionClient,
    actor: AuditActor,
    entityType: AuditEntityType,
    action: AuditAction,
    before: Record<string, unknown> | null,
    after: Record<string, unknown>,
    reason: string | null,
  ) {
    return tx.auditEvent.create({
      data: {
        entityType,
        entityId: String(after.id),
        action,
        actorId: actor.id,
        actorNameSnapshot: actor.displayName,
        actorRoleSnapshot: actor.role,
        recordedAt: await this.database.time(tx),
        reason,
        beforeSnapshot:
          before === null ? Prisma.DbNull : this.snapshot(entityType, before),
        afterSnapshot: this.snapshot(entityType, after),
      },
    });
  }
  private snapshot(
    type: AuditEntityType,
    value: Record<string, unknown>,
  ): Prisma.InputJsonObject {
    const result: Record<string, string | boolean | null> = {};
    for (const key of fields[type]) {
      const field = value[key];
      if (key === 'weightKg' && field instanceof Prisma.Decimal)
        result[key] = field.toFixed(3);
      else if (
        field === null ||
        typeof field === 'string' ||
        typeof field === 'boolean'
      )
        result[key] = field;
      else throw new Error(`Invalid audit snapshot field: ${type}.${key}`);
    }
    return result;
  }
}
