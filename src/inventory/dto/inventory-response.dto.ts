import { ApiProperty } from '@nestjs/swagger';
import {
  ReceiptIssueType,
  ReceiptLineCondition,
  ReturnIssueType,
  ReturnReviewDecision,
  StockAdjustmentDirection,
  StockMovementKind,
} from '../../generated/prisma/client.js';
export class InventoryBalanceResponseDto {
  @ApiProperty({ type: String, format: 'uuid' }) itemId!: string;
  @ApiProperty({ type: String, format: 'uuid' }) merchantId!: string;
  @ApiProperty({ type: String }) itemCode!: string;
  @ApiProperty({ type: String }) itemName!: string;
  @ApiProperty({ type: Boolean }) isActive!: boolean;
  @ApiProperty({ type: Number }) quantity!: number;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  updatedAt!: string | null;
}
export class MovementReceiptHeaderDto {
  @ApiProperty({ type: String, format: 'uuid' }) id!: string;
  @ApiProperty({ type: String }) merchantNameSnapshot!: string;
  @ApiProperty({ type: String }) receivedByNameSnapshot!: string;
  @ApiProperty({ type: String, format: 'date-time' }) receivedAt!: string;
}
export class MovementReceiptLineDto {
  @ApiProperty({ type: String, format: 'uuid' }) id!: string;
  @ApiProperty({ type: Number }) quantity!: number;
  @ApiProperty({ enum: ReceiptLineCondition }) condition!: ReceiptLineCondition;
  @ApiProperty({ enum: ReceiptIssueType, nullable: true })
  issueType!: ReceiptIssueType | null;
  @ApiProperty({ type: String, nullable: true }) notes!: string | null;
  @ApiProperty({ type: MovementReceiptHeaderDto })
  receipt!: MovementReceiptHeaderDto;
}
export class MovementAdjustmentDto {
  @ApiProperty({ type: String, format: 'uuid' }) id!: string;
  @ApiProperty({ enum: StockAdjustmentDirection })
  direction!: StockAdjustmentDirection;
  @ApiProperty({ type: Number }) quantity!: number;
  @ApiProperty({ type: String }) reason!: string;
  @ApiProperty({ type: String }) performedByNameSnapshot!: string;
  @ApiProperty({ type: String, format: 'date-time' }) recordedAt!: string;
  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  referenceMovementId!: string | null;
  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  stocktakeLineId!: string | null;
}
export class MovementShipmentLineDto {
  @ApiProperty({ type: String, format: 'uuid' }) id!: string;
  @ApiProperty({ type: String, format: 'uuid' }) shipmentId!: string;
  @ApiProperty({ type: Number }) quantity!: number;
}
export class MovementShipmentDispatchDto {
  @ApiProperty({ type: String, format: 'uuid' }) id!: string;
  @ApiProperty({ type: String, format: 'uuid' }) shipmentId!: string;
  @ApiProperty({ type: String, format: 'uuid' }) dispatchedById!: string;
  @ApiProperty({ type: String }) dispatchedByNameSnapshot!: string;
  @ApiProperty({ type: String, format: 'date-time' }) dispatchedAt!: string;
  @ApiProperty({ type: String }) carrierName!: string;
  @ApiProperty({ type: String }) trackingNumber!: string;
}
export class MovementReturnReceiptDto {
  @ApiProperty({ type: String, format: 'uuid' }) id!: string;
  @ApiProperty({ type: String, format: 'uuid' }) shipmentId!: string;
  @ApiProperty({ type: String, format: 'uuid' }) receivedById!: string;
  @ApiProperty({ type: String }) receivedByNameSnapshot!: string;
  @ApiProperty({ type: String, format: 'date-time' }) receivedAt!: string;
}
export class MovementReturnInspectionDto {
  @ApiProperty({ type: String, format: 'uuid' }) id!: string;
  @ApiProperty({ type: String, format: 'uuid' }) inspectedById!: string;
  @ApiProperty({ type: String }) inspectedByNameSnapshot!: string;
  @ApiProperty({ type: String, format: 'date-time' }) inspectedAt!: string;
  @ApiProperty({ type: MovementReturnReceiptDto })
  receipt!: MovementReturnReceiptDto;
}
export class MovementReturnLineDto {
  @ApiProperty({ type: String, format: 'uuid' }) id!: string;
  @ApiProperty({ type: String, format: 'uuid' }) receiptId!: string;
  @ApiProperty({ type: String, format: 'uuid' }) receiptLineId!: string;
  @ApiProperty({ type: Number }) quantity!: number;
  @ApiProperty({ enum: ReceiptLineCondition }) condition!: ReceiptLineCondition;
  @ApiProperty({ enum: ReturnIssueType, nullable: true })
  issueType!: ReturnIssueType | null;
  @ApiProperty({ type: String, nullable: true }) notes!: string | null;
  @ApiProperty({ type: MovementReturnInspectionDto })
  inspection!: MovementReturnInspectionDto;
}
export class MovementReturnReviewDto {
  @ApiProperty({ type: String, format: 'uuid' }) id!: string;
  @ApiProperty({ enum: ReturnReviewDecision }) decision!: ReturnReviewDecision;
  @ApiProperty({ type: String }) reason!: string;
  @ApiProperty({ type: String, format: 'uuid' }) reviewedById!: string;
  @ApiProperty({ type: String }) reviewedByNameSnapshot!: string;
  @ApiProperty({ type: String, format: 'date-time' }) reviewedAt!: string;
}
export class InventoryMovementResponseDto {
  @ApiProperty({ type: String, format: 'uuid' }) id!: string;
  @ApiProperty({ type: String, format: 'uuid' }) merchantId!: string;
  @ApiProperty({ type: String, format: 'uuid' }) itemId!: string;
  @ApiProperty({ type: String }) itemCodeSnapshot!: string;
  @ApiProperty({ type: String }) itemNameSnapshot!: string;
  @ApiProperty({ enum: StockMovementKind }) kind!: StockMovementKind;
  @ApiProperty({ type: Number }) quantityDelta!: number;
  @ApiProperty({ type: String, format: 'uuid' }) actorId!: string;
  @ApiProperty({ type: String }) actorNameSnapshot!: string;
  @ApiProperty({ type: String, format: 'date-time' }) recordedAt!: string;
  @ApiProperty({ type: MovementReturnLineDto, nullable: true })
  returnInspectionLine!: MovementReturnLineDto | null;
  @ApiProperty({ type: MovementReturnReviewDto, nullable: true })
  returnReview!: MovementReturnReviewDto | null;
  @ApiProperty({ type: MovementShipmentLineDto, nullable: true })
  shipmentLine!: MovementShipmentLineDto | null;
  @ApiProperty({ type: MovementShipmentDispatchDto, nullable: true })
  shipmentDispatch!: MovementShipmentDispatchDto | null;
  @ApiProperty({ type: MovementReceiptLineDto, nullable: true })
  receiptLine!: MovementReceiptLineDto | null;
  @ApiProperty({ type: MovementAdjustmentDto, nullable: true })
  adjustment!: MovementAdjustmentDto | null;
}
export class InventoryBalancesResponseDto {
  @ApiProperty({ type: [InventoryBalanceResponseDto] })
  items!: InventoryBalanceResponseDto[];
  @ApiProperty({ type: Number }) total!: number;
  @ApiProperty({ type: Number }) page!: number;
  @ApiProperty({ type: Number }) limit!: number;
}
export class InventoryMovementsResponseDto {
  @ApiProperty({ type: [InventoryMovementResponseDto] })
  items!: InventoryMovementResponseDto[];
  @ApiProperty({ type: Number }) total!: number;
  @ApiProperty({ type: Number }) page!: number;
  @ApiProperty({ type: Number }) limit!: number;
}
