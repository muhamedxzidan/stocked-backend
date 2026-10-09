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
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { ShelfQuantityDto } from '../../inventory/dto/stock-placement.dto.js';
import {
  ReceiptIssueType,
  ReceiptLineCondition,
} from '../../generated/prisma/client.js';

export class CreateReceiptLineDto {
  @ApiPropertyOptional({ type: [ShelfQuantityDto] })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => ShelfQuantityDto)
  placements?: ShelfQuantityDto[];

  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  itemId!: string;

  @ApiProperty({ minimum: 1, maximum: 1000000 })
  @IsInt()
  @Min(1)
  @Max(1_000_000)
  quantity!: number;

  @ApiProperty({ enum: ReceiptLineCondition })
  @IsEnum(ReceiptLineCondition)
  condition!: ReceiptLineCondition;

  @ApiPropertyOptional({ enum: ReceiptIssueType, nullable: true })
  @ValidateIf(
    (_object, value: unknown) => value !== undefined && value !== null,
  )
  @IsEnum(ReceiptIssueType)
  issueType?: ReceiptIssueType | null;

  @ApiPropertyOptional({ minLength: 10, maxLength: 2000, nullable: true })
  @ValidateIf(
    (_object, value: unknown) => value !== undefined && value !== null,
  )
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(10)
  @MaxLength(2000)
  notes?: string | null;
}

export class CreateReceiptDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  merchantId!: string;

  @ApiPropertyOptional({ maxLength: 2000, nullable: true })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MaxLength(2000)
  notes?: string | null;

  @ApiProperty({ type: [CreateReceiptLineDto], minItems: 1, maxItems: 100 })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => CreateReceiptLineDto)
  lines!: CreateReceiptLineDto[];
}
