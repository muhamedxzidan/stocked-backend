import { ApiProperty } from '@nestjs/swagger';
import {
  StocktakeKind,
  StocktakeStatus,
} from '../../generated/prisma/client.js';
export class StocktakeStaffResponseDto {
  @ApiProperty({ type: String, format: 'uuid' })
  id!: string;
  @ApiProperty({ type: String, format: 'uuid' })
  warehouseId!: string;
  @ApiProperty({ enum: StocktakeKind })
  kind!: StocktakeKind;
  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  targetId!: string | null;
  @ApiProperty({ enum: StocktakeStatus })
  status!: StocktakeStatus;
  @ApiProperty({ type: String, format: 'uuid' })
  openedById!: string;
  @ApiProperty({ type: String })
  openedByNameSnapshot!: string;
  @ApiProperty({ type: String, format: 'date-time' })
  openedAt!: string;
  @ApiProperty({ type: String, format: 'uuid' })
  directorId!: string;
  @ApiProperty({ type: String })
  directorNameSnapshot!: string;
  @ApiProperty({ type: String })
  notes!: string;
  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  closedById!: string | null;
  @ApiProperty({ type: String, nullable: true })
  closedByNameSnapshot!: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  closedAt!: string | null;
  @ApiProperty({ type: String, nullable: true })
  closingNotes!: string | null;
}
export class StocktakeMerchantResponseDto {
  @ApiProperty({ type: String, format: 'uuid' })
  id!: string;
  @ApiProperty({ enum: StocktakeKind })
  kind!: StocktakeKind;
  @ApiProperty({ enum: StocktakeStatus })
  status!: StocktakeStatus;
  @ApiProperty({ type: String, format: 'date-time' })
  openedAt!: string;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  closedAt!: string | null;
}
export class StocktakeMerchantLineResponseDto {
  @ApiProperty({ type: String, format: 'uuid' })
  id!: string;
  @ApiProperty({ type: String, format: 'uuid' })
  stocktakeId!: string;
  @ApiProperty({ type: String, format: 'uuid' })
  warehouseId!: string;
  @ApiProperty({ type: String, format: 'uuid' })
  merchantId!: string;
  @ApiProperty({ type: String, format: 'uuid' })
  shelfId!: string;
  @ApiProperty({ type: String, format: 'uuid' })
  itemId!: string;
  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  receiptLineId!: string | null;
  @ApiProperty({ type: String })
  category!: string;
  @ApiProperty({ type: String })
  itemCodeSnapshot!: string;
  @ApiProperty({ type: String })
  itemNameSnapshot!: string;
  @ApiProperty({ type: Number })
  expectedQuantity!: number;
  @ApiProperty({ type: Number })
  version!: number;
  @ApiProperty({ type: Number, nullable: true })
  quantity!: number | null;
  @ApiProperty({ type: Number, nullable: true })
  difference!: number | null;
  @ApiProperty({ type: String, nullable: true })
  reason!: string | null;
  @ApiProperty({ type: String, nullable: true })
  notes!: string | null;
}
export class StocktakeStaffLineResponseDto {
  @ApiProperty({ type: String, format: 'uuid' })
  id!: string;
  @ApiProperty({ type: String, format: 'uuid' })
  stocktakeId!: string;
  @ApiProperty({ type: String, format: 'uuid' })
  warehouseId!: string;
  @ApiProperty({ type: String, format: 'uuid' })
  merchantId!: string;
  @ApiProperty({ type: String, format: 'uuid' })
  shelfId!: string;
  @ApiProperty({ type: String, format: 'uuid' })
  itemId!: string;
  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  receiptLineId!: string | null;
  @ApiProperty({ type: String })
  category!: string;
  @ApiProperty({ type: String })
  itemCodeSnapshot!: string;
  @ApiProperty({ type: String })
  itemNameSnapshot!: string;
  @ApiProperty({ type: Number })
  expectedQuantity!: number;
  @ApiProperty({ type: Number })
  version!: number;
  @ApiProperty({ type: Number, nullable: true })
  quantity!: number | null;
  @ApiProperty({ type: Number, nullable: true })
  difference!: number | null;
  @ApiProperty({ type: String, nullable: true })
  reason!: string | null;
  @ApiProperty({ type: String, nullable: true })
  notes!: string | null;
  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  countedById!: string | null;
  @ApiProperty({ type: String, nullable: true })
  countedByNameSnapshot!: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  countedAt!: string | null;
}
export class StocktakeScopeResponseDto {
  @ApiProperty({ type: String, format: 'uuid' })
  id!: string;
  @ApiProperty({ type: String, format: 'uuid' })
  stocktakeId!: string;
  @ApiProperty({ type: String, format: 'uuid' })
  shelfId!: string;
  @ApiProperty({ type: String, format: 'uuid' })
  rowId!: string;
  @ApiProperty({ type: String, format: 'uuid' })
  merchantId!: string;
  @ApiProperty({ type: String })
  shelfCodeSnapshot!: string;
  @ApiProperty({ type: String })
  rowCodeSnapshot!: string;
  @ApiProperty({ type: String })
  merchantNameSnapshot!: string;
}
export class StocktakeEventResponseDto {
  @ApiProperty({ type: Number })
  sequence!: number;
  @ApiProperty({ type: String, format: 'uuid' })
  id!: string;
  @ApiProperty({ type: String, format: 'uuid' })
  stocktakeId!: string;
  @ApiProperty({ type: String })
  kind!: string;
  @ApiProperty({ type: String, format: 'uuid' })
  actorId!: string;
  @ApiProperty({ type: String })
  actorNameSnapshot!: string;
  @ApiProperty({ type: String, format: 'date-time' })
  recordedAt!: string;
  @ApiProperty({ type: 'object', additionalProperties: true })
  details!: Record<string, unknown>;
  @ApiProperty({ type: String, format: 'uuid' })
  idempotencyKey!: string;
  @ApiProperty({ type: String })
  requestHash!: string;
}
export class StocktakesStaffResponseDto {
  @ApiProperty({ type: [StocktakeStaffResponseDto] })
  items!: StocktakeStaffResponseDto[];
  @ApiProperty() total!: number;
  @ApiProperty() page!: number;
  @ApiProperty() limit!: number;
}
export class StocktakesMerchantResponseDto {
  @ApiProperty({ type: [StocktakeMerchantResponseDto] })
  items!: StocktakeMerchantResponseDto[];
  @ApiProperty() total!: number;
  @ApiProperty() page!: number;
  @ApiProperty() limit!: number;
}
export class StocktakeStaffLinesResponseDto {
  @ApiProperty({ type: [StocktakeStaffLineResponseDto] })
  items!: StocktakeStaffLineResponseDto[];
  @ApiProperty() total!: number;
  @ApiProperty() page!: number;
  @ApiProperty() limit!: number;
}
export class StocktakeMerchantLinesResponseDto {
  @ApiProperty({ type: [StocktakeMerchantLineResponseDto] })
  items!: StocktakeMerchantLineResponseDto[];
  @ApiProperty() total!: number;
  @ApiProperty() page!: number;
  @ApiProperty() limit!: number;
}
export class StocktakeScopesResponseDto {
  @ApiProperty({ type: [StocktakeScopeResponseDto] })
  items!: StocktakeScopeResponseDto[];
  @ApiProperty() total!: number;
  @ApiProperty() page!: number;
  @ApiProperty() limit!: number;
}
export class StocktakeEventsResponseDto {
  @ApiProperty({ type: [StocktakeEventResponseDto] })
  items!: StocktakeEventResponseDto[];
  @ApiProperty() total!: number;
  @ApiProperty() page!: number;
  @ApiProperty() limit!: number;
}
export class StocktakeCommandResponseDto {
  @ApiProperty() replayed!: boolean;
  @ApiProperty({ type: StocktakeEventResponseDto })
  event!: StocktakeEventResponseDto;
}
