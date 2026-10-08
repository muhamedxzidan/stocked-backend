import { ApiProperty } from '@nestjs/swagger';
import { ItemResponseDto } from './item-response.dto.js';
export class ItemPageDto {
  @ApiProperty({ type: [ItemResponseDto] }) items: ItemResponseDto[];
  @ApiProperty({}) total: number;
  @ApiProperty({}) page: number;
  @ApiProperty({}) limit: number;
}
