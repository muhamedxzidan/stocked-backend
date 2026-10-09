import { Transform } from 'class-transformer';
import { IsBoolean, IsString, MinLength, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
export class SetItemStatusDto {
  @ApiProperty({ type: String, minLength: 10, maxLength: 2000 })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(10)
  @MaxLength(2000)
  reason!: string;
  @ApiProperty({ type: Boolean }) @IsBoolean() isActive!: boolean;
}
