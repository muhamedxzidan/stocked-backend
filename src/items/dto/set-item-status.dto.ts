import { IsBoolean } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
export class SetItemStatusDto {
  @ApiProperty({ type: Boolean }) @IsBoolean() isActive: boolean;
}
