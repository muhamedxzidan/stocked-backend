import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { ShelfQuantityDto } from '../../inventory/dto/stock-placement.dto.js';
import { ReturnReviewDecision } from '../../generated/prisma/client.js';
export class ReviewReturnDto {
  @ApiPropertyOptional({ type: [ShelfQuantityDto] })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => ShelfQuantityDto)
  custodySources?: ShelfQuantityDto[];

  @ApiPropertyOptional({ type: [ShelfQuantityDto] })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => ShelfQuantityDto)
  placements?: ShelfQuantityDto[];

  @ApiProperty({ enum: ReturnReviewDecision })
  @IsEnum(ReturnReviewDecision)
  decision!: ReturnReviewDecision;
  @ApiProperty({ minLength: 10, maxLength: 2000 })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(10)
  @MaxLength(2000)
  reason!: string;
}
