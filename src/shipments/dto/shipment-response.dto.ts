import { ApiProperty } from '@nestjs/swagger';
import { ShipmentStatus } from './list-shipments.dto.js';

export class ShipmentLineResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) itemId!: string;
  @ApiProperty() position!: number;
  @ApiProperty() itemCodeSnapshot!: string;
  @ApiProperty() itemNameSnapshot!: string;
  @ApiProperty() quantity!: number;
}
export class ShipmentRegistrationResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() code!: string;
  @ApiProperty({ format: 'uuid' }) merchantId!: string;
  @ApiProperty() merchantNameSnapshot!: string;
  @ApiProperty({ format: 'uuid' }) registeredById!: string;
  @ApiProperty() registeredByNameSnapshot!: string;
  @ApiProperty({ type: String, format: 'date-time' }) registeredAt!: Date;
  @ApiProperty({ type: String, nullable: true }) notes!: string | null;
  @ApiProperty({ type: [ShipmentLineResponseDto] })
  lines!: ShipmentLineResponseDto[];
}
export class ShipmentPreparationResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) shipmentId!: string;
  @ApiProperty({ format: 'uuid' }) preparedById!: string;
  @ApiProperty() preparedByNameSnapshot!: string;
  @ApiProperty({ type: String, format: 'date-time' }) preparedAt!: Date;
}
export class ShipmentDispatchResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) shipmentId!: string;
  @ApiProperty({ format: 'uuid' }) preparationId!: string;
  @ApiProperty({ format: 'uuid' }) dispatchedById!: string;
  @ApiProperty() dispatchedByNameSnapshot!: string;
  @ApiProperty({ type: String, format: 'date-time' }) dispatchedAt!: Date;
  @ApiProperty() carrierName!: string;
  @ApiProperty() trackingNumber!: string;
}
export class ShipmentTimelineResponseDto {
  @ApiProperty({ enum: ShipmentStatus }) step!: ShipmentStatus;
  @ApiProperty({ format: 'uuid' }) actorId!: string;
  @ApiProperty() actorNameSnapshot!: string;
  @ApiProperty({ type: String, format: 'date-time' }) recordedAt!: Date;
}
export class ShipmentDetailResponseDto extends ShipmentRegistrationResponseDto {
  @ApiProperty({ enum: ShipmentStatus }) status!: ShipmentStatus;
  @ApiProperty({ type: ShipmentPreparationResponseDto, nullable: true })
  preparation!: ShipmentPreparationResponseDto | null;
  @ApiProperty({ type: ShipmentDispatchResponseDto, nullable: true })
  dispatch!: ShipmentDispatchResponseDto | null;
  @ApiProperty({ type: [ShipmentTimelineResponseDto] })
  timeline!: ShipmentTimelineResponseDto[];
}
export class ShipmentListResponseDto {
  @ApiProperty({ type: [ShipmentDetailResponseDto] })
  items!: ShipmentDetailResponseDto[];
  @ApiProperty() total!: number;
  @ApiProperty() page!: number;
  @ApiProperty() limit!: number;
}
