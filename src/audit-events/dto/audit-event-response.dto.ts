import { ApiProperty, getSchemaPath } from '@nestjs/swagger';
import {
  AuditAction,
  AuditEntityType,
  UserRole,
} from '../../generated/prisma/client.js';
export class ItemAuditSnapshotDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) merchantId!: string;
  @ApiProperty({ type: String }) code!: string;
  @ApiProperty({ type: String }) name!: string;
  @ApiProperty({ type: String, nullable: true }) brand!: string | null;
  @ApiProperty({ type: String, nullable: true }) color!: string | null;
  @ApiProperty({ type: String }) weightKg!: string;
  @ApiProperty({ type: String, nullable: true }) notes!: string | null;
  @ApiProperty({ type: Boolean }) isActive!: boolean;
}
export class RowAuditSnapshotDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) warehouseId!: string;
  @ApiProperty({ type: String }) code!: string;
  @ApiProperty({ type: String }) name!: string;
  @ApiProperty({ type: Boolean }) isActive!: boolean;
}
export class ShelfAuditSnapshotDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) warehouseId!: string;
  @ApiProperty({ format: 'uuid' }) rowId!: string;
  @ApiProperty({ format: 'uuid' }) merchantId!: string;
  @ApiProperty({ type: String }) code!: string;
  @ApiProperty({ type: String }) name!: string;
  @ApiProperty({ type: Boolean }) isActive!: boolean;
}
export class UserAuditSnapshotDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'email' }) email!: string;
  @ApiProperty({ type: String }) displayName!: string;
  @ApiProperty({ enum: UserRole }) role!: UserRole;
  @ApiProperty({ type: String, format: 'uuid', nullable: true }) merchantId!:
    string | null;
  @ApiProperty({ type: Boolean }) isActive!: boolean;
  @ApiProperty({ type: Boolean }) mustChangePassword!: boolean;
}
export class MerchantAuditSnapshotDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ type: String }) code!: string;
  @ApiProperty({ type: String }) name!: string;
  @ApiProperty({ type: String }) phone!: string;
  @ApiProperty({ type: Boolean }) isActive!: boolean;
}
const snapshots = [
  { $ref: getSchemaPath(ItemAuditSnapshotDto) },
  { $ref: getSchemaPath(RowAuditSnapshotDto) },
  { $ref: getSchemaPath(ShelfAuditSnapshotDto) },
  { $ref: getSchemaPath(UserAuditSnapshotDto) },
  { $ref: getSchemaPath(MerchantAuditSnapshotDto) },
];
export class AuditEventResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ enum: AuditEntityType }) entityType!: AuditEntityType;
  @ApiProperty({ format: 'uuid' }) entityId!: string;
  @ApiProperty({ enum: AuditAction }) action!: AuditAction;
  @ApiProperty({ format: 'uuid' }) actorId!: string;
  @ApiProperty() actorNameSnapshot!: string;
  @ApiProperty({ enum: UserRole }) actorRoleSnapshot!: UserRole;
  @ApiProperty({ format: 'date-time' }) recordedAt!: string;
  @ApiProperty({ type: String, nullable: true, maxLength: 2000 }) reason!:
    string | null;
  @ApiProperty({
    anyOf: [...snapshots, { type: 'object', nullable: true, enum: [null] }],
    nullable: true,
  })
  beforeSnapshot!: object | null;
  @ApiProperty({ anyOf: snapshots }) afterSnapshot!: object;
}
export class AuditEventsPageDto {
  @ApiProperty({ type: [AuditEventResponseDto] })
  items!: AuditEventResponseDto[];
  @ApiProperty() total!: number;
  @ApiProperty() page!: number;
  @ApiProperty() limit!: number;
}
