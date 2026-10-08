import { IsBoolean } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
export class SetMerchantStatusDto {
  @ApiProperty({ type: Boolean }) @IsBoolean() isActive: boolean;
}
