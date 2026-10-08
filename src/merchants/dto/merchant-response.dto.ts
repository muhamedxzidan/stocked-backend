import { ApiProperty } from '@nestjs/swagger';

export class MerchantResponseDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ example: 'MZ' }) code: string;
  @ApiProperty({}) name: string;
  @ApiProperty({}) phone: string;
  @ApiProperty({}) isActive: boolean;
  @ApiProperty({ format: 'uuid' }) createdById: string;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt: Date;
  @ApiProperty({ type: String, format: 'date-time' }) updatedAt: Date;
}
