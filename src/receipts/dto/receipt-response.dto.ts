import { ApiProperty } from '@nestjs/swagger';
import {
  ReceiptIssueType,
  ReceiptLineCondition,
} from '../../generated/prisma/client.js';
export class ReceiptMovementReferenceDto {
  @ApiProperty({ type: String, format: 'uuid' }) id!: string;
}
export class ReceiptLineResponseDto {
  @ApiProperty({ type: String, format: 'uuid' }) id!: string;
  @ApiProperty({ type: String, format: 'uuid' }) itemId!: string;
  @ApiProperty({ type: String }) itemCodeSnapshot!: string;
  @ApiProperty({ type: String }) itemNameSnapshot!: string;
  @ApiProperty({ type: Number }) quantity!: number;
  @ApiProperty({ enum: ReceiptLineCondition }) condition!: ReceiptLineCondition;
  @ApiProperty({ enum: ReceiptIssueType, nullable: true })
  issueType!: ReceiptIssueType | null;
  @ApiProperty({ type: String, nullable: true }) notes!: string | null;
  @ApiProperty({ type: Number }) position!: number;
  @ApiProperty({ type: ReceiptMovementReferenceDto, nullable: true })
  movement!: ReceiptMovementReferenceDto | null;
}
export class ReceiptResponseDto {
  @ApiProperty({ type: String, format: 'uuid' }) id!: string;
  @ApiProperty({ type: String, format: 'uuid' }) merchantId!: string;
  @ApiProperty({ type: String }) merchantNameSnapshot!: string;
  @ApiProperty({ type: String, format: 'uuid' }) receivedById!: string;
  @ApiProperty({ type: String }) receivedByNameSnapshot!: string;
  @ApiProperty({ type: String, format: 'date-time' }) receivedAt!: string;
  @ApiProperty({ type: String, nullable: true }) notes!: string | null;
  @ApiProperty({ type: [ReceiptLineResponseDto] })
  lines!: ReceiptLineResponseDto[];
}
export class ReceiptListResponseDto {
  @ApiProperty({ type: [ReceiptResponseDto] }) items!: ReceiptResponseDto[];
  @ApiProperty({ type: Number }) total!: number;
  @ApiProperty({ type: Number }) page!: number;
  @ApiProperty({ type: Number }) limit!: number;
}
