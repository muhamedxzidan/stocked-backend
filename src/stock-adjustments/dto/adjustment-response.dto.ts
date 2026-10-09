import { ApiProperty } from '@nestjs/swagger';
import {
  StockAdjustmentDirection,
  StockMovementKind,
} from '../../generated/prisma/client.js';
export class AdjustmentMovementResponseDto {
  @ApiProperty({ type: String, format: 'uuid' }) id!: string;
  @ApiProperty({ enum: StockMovementKind }) kind!: StockMovementKind;
  @ApiProperty({ type: Number }) quantityDelta!: number;
}
export class AdjustmentResponseDto {
  @ApiProperty({ type: String, format: 'uuid' }) id!: string;
  @ApiProperty({ type: String, format: 'uuid' }) merchantId!: string;
  @ApiProperty({ type: String }) merchantNameSnapshot!: string;
  @ApiProperty({ type: String, format: 'uuid' }) itemId!: string;
  @ApiProperty({ type: String }) itemCodeSnapshot!: string;
  @ApiProperty({ type: String }) itemNameSnapshot!: string;
  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  referenceMovementId!: string | null;
  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  stocktakeLineId!: string | null;
  @ApiProperty({ enum: StockAdjustmentDirection })
  direction!: StockAdjustmentDirection;
  @ApiProperty({ type: Number }) quantity!: number;
  @ApiProperty({ type: Number }) quantityDelta!: number;
  @ApiProperty({ type: String }) reason!: string;
  @ApiProperty({ type: String, format: 'uuid' }) performedById!: string;
  @ApiProperty({ type: String }) performedByNameSnapshot!: string;
  @ApiProperty({ type: String, format: 'date-time' }) recordedAt!: string;
  @ApiProperty({ type: AdjustmentMovementResponseDto, nullable: true })
  movement!: AdjustmentMovementResponseDto | null;
}
export class AdjustmentListResponseDto {
  @ApiProperty({ type: [AdjustmentResponseDto] })
  items!: AdjustmentResponseDto[];
  @ApiProperty({ type: Number }) total!: number;
  @ApiProperty({ type: Number }) page!: number;
  @ApiProperty({ type: Number }) limit!: number;
}
