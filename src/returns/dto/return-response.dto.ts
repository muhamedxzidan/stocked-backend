import { ApiProperty } from '@nestjs/swagger';
import {
  ReceiptLineCondition,
  ReturnIssueType,
  ReturnReviewDecision,
} from '../../generated/prisma/client.js';
import { ReturnStatus } from './list-returns.dto.js';
export class ReturnReceiptLineResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) shipmentLineId!: string;
  @ApiProperty({ format: 'uuid' }) itemId!: string;
  @ApiProperty() position!: number;
  @ApiProperty() quantity!: number;
  @ApiProperty() itemCodeSnapshot!: string;
  @ApiProperty() itemNameSnapshot!: string;
}
export class ReturnReceiptResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) merchantId!: string;
  @ApiProperty({ format: 'uuid' }) shipmentId!: string;
  @ApiProperty({ format: 'uuid' }) dispatchId!: string;
  @ApiProperty() merchantNameSnapshot!: string;
  @ApiProperty() shipmentCodeSnapshot!: string;
  @ApiProperty({ format: 'uuid' }) receivedById!: string;
  @ApiProperty() receivedByNameSnapshot!: string;
  @ApiProperty({ type: String, format: 'date-time' }) receivedAt!: string;
  @ApiProperty({ type: String, nullable: true }) notes!: string | null;
  @ApiProperty({ type: [ReturnReceiptLineResponseDto] })
  lines!: ReturnReceiptLineResponseDto[];
}
export class ReturnReviewResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) inspectionLineId!: string;
  @ApiProperty({ enum: ReturnReviewDecision }) decision!: ReturnReviewDecision;
  @ApiProperty() reason!: string;
  @ApiProperty({ format: 'uuid' }) reviewedById!: string;
  @ApiProperty() reviewedByNameSnapshot!: string;
  @ApiProperty({ type: String, format: 'date-time' }) reviewedAt!: string;
}
export class ReturnGroupResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) receiptLineId!: string;
  @ApiProperty({ format: 'uuid' }) itemId!: string;
  @ApiProperty() position!: number;
  @ApiProperty() quantity!: number;
  @ApiProperty({ enum: ReceiptLineCondition }) condition!: ReceiptLineCondition;
  @ApiProperty({ enum: ReturnIssueType, nullable: true })
  issueType!: ReturnIssueType | null;
  @ApiProperty({ type: String, nullable: true }) notes!: string | null;
}
export class ReturnInspectionResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) receiptId!: string;
  @ApiProperty({ format: 'uuid' }) inspectedById!: string;
  @ApiProperty() inspectedByNameSnapshot!: string;
  @ApiProperty({ type: String, format: 'date-time' }) inspectedAt!: string;
  @ApiProperty({ type: [ReturnGroupResponseDto] })
  lines!: ReturnGroupResponseDto[];
}
export class ReturnReadGroupResponseDto extends ReturnGroupResponseDto {
  @ApiProperty({
    enum: [
      'GOOD_RESTOCKED',
      'PENDING_REVIEW',
      'ACCEPTED_TO_STOCK',
      'REJECTED_OUTSIDE_STOCK',
    ],
  })
  status!: string;
  @ApiProperty({ type: ReturnReviewResponseDto, nullable: true })
  review!: ReturnReviewResponseDto | null;
}
export class ReturnReadInspectionResponseDto extends ReturnInspectionResponseDto {
  @ApiProperty({ type: [ReturnReadGroupResponseDto] })
  declare lines: ReturnReadGroupResponseDto[];
}
export class ReturnQuantitiesResponseDto {
  @ApiProperty() received!: number;
  @ApiProperty() uninspected!: number;
  @ApiProperty() restocked!: number;
  @ApiProperty() pending!: number;
  @ApiProperty() rejected!: number;
}
export class ReturnTimelineResponseDto {
  @ApiProperty() step!: string;
  @ApiProperty({ format: 'uuid' }) actorId!: string;
  @ApiProperty() actorNameSnapshot!: string;
  @ApiProperty({ type: String, format: 'date-time' }) recordedAt!: string;
  @ApiProperty({ required: false, format: 'uuid' }) inspectionLineId?: string;
}
export class ReturnDetailResponseDto extends ReturnReceiptResponseDto {
  @ApiProperty({ type: ReturnReadInspectionResponseDto, nullable: true })
  inspection!: ReturnReadInspectionResponseDto | null;
  @ApiProperty({ enum: ReturnStatus }) status!: ReturnStatus;
  @ApiProperty({ type: ReturnQuantitiesResponseDto })
  quantities!: ReturnQuantitiesResponseDto;
  @ApiProperty({ type: [ReturnTimelineResponseDto] })
  timeline!: ReturnTimelineResponseDto[];
}
export class ReturnListResponseDto {
  @ApiProperty({ type: [ReturnDetailResponseDto] })
  items!: ReturnDetailResponseDto[];
  @ApiProperty() total!: number;
  @ApiProperty() page!: number;
  @ApiProperty() limit!: number;
}
