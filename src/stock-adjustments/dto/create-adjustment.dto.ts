import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { StockAdjustmentDirection } from '../../generated/prisma/client.js';
export class CreateAdjustmentDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID('4') referenceMovementId!: string;
  @ApiProperty({ enum: StockAdjustmentDirection })
  @IsEnum(StockAdjustmentDirection)
  direction!: StockAdjustmentDirection;
  @ApiProperty({ minimum: 1, maximum: 1000000 })
  @IsInt()
  @Min(1)
  @Max(1_000_000)
  quantity!: number;
  @ApiProperty({ minLength: 10, maxLength: 2000 })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(10)
  @MaxLength(2000)
  reason!: string;
}
