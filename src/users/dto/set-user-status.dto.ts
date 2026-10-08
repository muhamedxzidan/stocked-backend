import { IsBoolean } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
export class SetUserStatusDto {
  @ApiProperty({ type: Boolean }) @IsBoolean() isActive: boolean;
}
