import { ApiProperty } from '@nestjs/swagger';
export class StorageRowResponseDto {
  @ApiProperty({ type: String, format: 'uuid' })
  id!: string;
  @ApiProperty({ type: String, format: 'uuid' })
  warehouseId!: string;
  @ApiProperty({ type: String })
  code!: string;
  @ApiProperty({ type: String })
  name!: string;
  @ApiProperty({ type: Boolean })
  isActive!: boolean;
  @ApiProperty({ type: String, format: 'uuid' })
  createdById!: string;
  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: string;
}
export class StorageShelfResponseDto {
  @ApiProperty({ type: String, format: 'uuid' })
  id!: string;
  @ApiProperty({ type: String, format: 'uuid' })
  warehouseId!: string;
  @ApiProperty({ type: String, format: 'uuid' })
  rowId!: string;
  @ApiProperty({ type: String, format: 'uuid' })
  merchantId!: string;
  @ApiProperty({ type: String })
  code!: string;
  @ApiProperty({ type: String })
  name!: string;
  @ApiProperty({ type: Boolean })
  isActive!: boolean;
  @ApiProperty({ type: String, format: 'uuid' })
  createdById!: string;
  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: string;
}
export class StorageBalanceResponseDto {
  @ApiProperty({ type: String, format: 'uuid' })
  id!: string;
  @ApiProperty({ type: String, format: 'uuid' })
  warehouseId!: string;
  @ApiProperty({ type: String, format: 'uuid' })
  merchantId!: string;
  @ApiProperty({ type: String, format: 'uuid' })
  itemId!: string;
  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  shelfId!: string | null;
  @ApiProperty({ type: Number })
  quantity!: number;
  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt!: string;
}
export class CustodyBalanceResponseDto {
  @ApiProperty({ type: String, format: 'uuid' })
  id!: string;
  @ApiProperty({ type: String, format: 'uuid' })
  receiptLineId!: string;
  @ApiProperty({ type: String, format: 'uuid' })
  warehouseId!: string;
  @ApiProperty({ type: String, format: 'uuid' })
  merchantId!: string;
  @ApiProperty({ type: String, format: 'uuid' })
  itemId!: string;
  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  shelfId!: string | null;
  @ApiProperty({ type: Number })
  quantity!: number;
  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt!: string;
}
export class StorageEntryResponseDto {
  @ApiProperty({ type: String, format: 'uuid' })
  id!: string;
  @ApiProperty({ type: String, format: 'uuid' })
  warehouseId!: string;
  @ApiProperty({ type: String, format: 'uuid' })
  merchantId!: string;
  @ApiProperty({ type: String, format: 'uuid' })
  itemId!: string;
  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  shelfId!: string | null;
  @ApiProperty({ type: Number })
  quantityDelta!: number;
  @ApiProperty({ type: String })
  kind!: string;
  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  movementId!: string | null;
  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  transferId!: string | null;
  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  actorId!: string | null;
  @ApiProperty({ type: String, nullable: true })
  actorNameSnapshot!: string | null;
  @ApiProperty({ type: String, format: 'date-time' })
  recordedAt!: string;
}
export class StorageTransferResponseDto {
  @ApiProperty({ type: String, format: 'uuid' })
  id!: string;
  @ApiProperty({ type: String, format: 'uuid' })
  warehouseId!: string;
  @ApiProperty({ type: String, format: 'uuid' })
  merchantId!: string;
  @ApiProperty({ type: String, format: 'uuid' })
  itemId!: string;
  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  fromShelfId!: string | null;
  @ApiProperty({ type: String, format: 'uuid' })
  toShelfId!: string;
  @ApiProperty({ type: Number })
  quantity!: number;
  @ApiProperty({ type: String })
  reason!: string;
  @ApiProperty({ type: String, format: 'uuid' })
  actorId!: string;
  @ApiProperty({ type: String })
  actorNameSnapshot!: string;
  @ApiProperty({ type: String, format: 'date-time' })
  recordedAt!: string;
  @ApiProperty({ type: String, format: 'uuid' })
  idempotencyKey!: string;
  @ApiProperty({ type: String })
  requestHash!: string;
}
export class CustodyTransferResponseDto {
  @ApiProperty({ type: String, format: 'uuid' })
  id!: string;
  @ApiProperty({ type: String, format: 'uuid' })
  receiptLineId!: string;
  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  fromShelfId!: string | null;
  @ApiProperty({ type: String, format: 'uuid' })
  toShelfId!: string;
  @ApiProperty({ type: Number })
  quantity!: number;
  @ApiProperty({ type: String })
  reason!: string;
  @ApiProperty({ type: String, format: 'uuid' })
  actorId!: string;
  @ApiProperty({ type: String })
  actorNameSnapshot!: string;
  @ApiProperty({ type: String, format: 'date-time' })
  recordedAt!: string;
  @ApiProperty({ type: String, format: 'uuid' })
  idempotencyKey!: string;
  @ApiProperty({ type: String })
  requestHash!: string;
}
export class StorageRowsResponseDto {
  @ApiProperty({ type: [StorageRowResponseDto] })
  items!: StorageRowResponseDto[];
  @ApiProperty() total!: number;
  @ApiProperty() page!: number;
  @ApiProperty() limit!: number;
}
export class StorageShelvesResponseDto {
  @ApiProperty({ type: [StorageShelfResponseDto] })
  items!: StorageShelfResponseDto[];
  @ApiProperty() total!: number;
  @ApiProperty() page!: number;
  @ApiProperty() limit!: number;
}
export class StorageBalancesResponseDto {
  @ApiProperty({ type: [StorageBalanceResponseDto] })
  items!: StorageBalanceResponseDto[];
  @ApiProperty() total!: number;
  @ApiProperty() page!: number;
  @ApiProperty() limit!: number;
}
export class CustodyBalancesResponseDto {
  @ApiProperty({ type: [CustodyBalanceResponseDto] })
  items!: CustodyBalanceResponseDto[];
  @ApiProperty() total!: number;
  @ApiProperty() page!: number;
  @ApiProperty() limit!: number;
}
export class StorageEntriesResponseDto {
  @ApiProperty({ type: [StorageEntryResponseDto] })
  items!: StorageEntryResponseDto[];
  @ApiProperty() total!: number;
  @ApiProperty() page!: number;
  @ApiProperty() limit!: number;
}
export class StorageTransfersResponseDto {
  @ApiProperty({ type: [StorageTransferResponseDto] })
  items!: StorageTransferResponseDto[];
  @ApiProperty() total!: number;
  @ApiProperty() page!: number;
  @ApiProperty() limit!: number;
}
export class StorageTransferResultDto {
  @ApiProperty() replayed!: boolean;
  @ApiProperty({ type: StorageTransferResponseDto })
  transfer!: StorageTransferResponseDto;
}
export class CustodyTransferResultDto {
  @ApiProperty() replayed!: boolean;
  @ApiProperty({ type: CustodyTransferResponseDto })
  transfer!: CustodyTransferResponseDto;
}
