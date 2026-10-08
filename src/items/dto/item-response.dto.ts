import { ApiProperty } from '@nestjs/swagger';
export class ItemResponseDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ format: 'uuid' }) merchantId: string;
  @ApiProperty({ example: 'MZ-000001' }) code: string;
  @ApiProperty({}) name: string;
  @ApiProperty({ type: String, nullable: true }) brand: string | null;
  @ApiProperty({ type: String, nullable: true }) color: string | null;
  @ApiProperty({ type: String, example: '0.250' }) weightKg: string;
  @ApiProperty({ type: String, nullable: true }) notes: string | null;
  @ApiProperty({}) isActive: boolean;
  @ApiProperty({ format: 'uuid' }) createdById: string;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt: Date;
  @ApiProperty({ type: String, format: 'date-time' }) updatedAt: Date;
}
