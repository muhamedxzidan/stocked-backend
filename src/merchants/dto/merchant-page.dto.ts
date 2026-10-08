import { ApiProperty } from '@nestjs/swagger';
import { MerchantResponseDto } from './merchant-response.dto.js';
export class MerchantPageDto {
  @ApiProperty({ type: [MerchantResponseDto] }) items: MerchantResponseDto[];
  @ApiProperty() total: number;
  @ApiProperty() page: number;
  @ApiProperty() limit: number;
}
