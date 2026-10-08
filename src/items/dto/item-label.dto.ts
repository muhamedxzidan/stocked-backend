import { ApiProperty } from '@nestjs/swagger';
export class ItemLabelDto {
  @ApiProperty({ example: 'MZ-000001' }) code: string;
  @ApiProperty({ enum: ['CODE128'] }) symbology: 'CODE128';
  @ApiProperty({}) itemName: string;
  @ApiProperty({}) merchantName: string;
  @ApiProperty({ example: 'MZ' }) merchantCode: string;
}
