import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { ShelfQuantityDto } from '../../inventory/dto/stock-placement.dto.js';
import { StockAdjustmentDirection } from '../../generated/prisma/client.js';
export class CreateAdjustmentDto {
  @ApiPropertyOptional({ type: [ShelfQuantityDto] })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => ShelfQuantityDto)
  placements?: ShelfQuantityDto[];

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
