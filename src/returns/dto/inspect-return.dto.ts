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
import {
  ReceiptLineCondition,
  ReturnIssueType,
} from '../../generated/prisma/client.js';

export class InspectReturnLineDto {
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

  @ApiProperty({ format: 'uuid' }) @IsUUID('4') receiptLineId!: string;
  @ApiProperty({ minimum: 1, maximum: 1000000 })
  @IsInt()
  @Min(1)
  @Max(1000000)
  quantity!: number;
  @ApiProperty({ enum: ReceiptLineCondition })
  @IsEnum(ReceiptLineCondition)
  condition!: ReceiptLineCondition;
  @ApiPropertyOptional({ enum: ReturnIssueType, nullable: true })
  @IsOptional()
  @IsEnum(ReturnIssueType)
  issueType?: ReturnIssueType | null;
  @ApiPropertyOptional({ maxLength: 2000, nullable: true })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(10)
  @MaxLength(2000)
  notes?: string | null;
}
export class InspectReturnDto {
  @ApiProperty({ type: [InspectReturnLineDto], minItems: 1, maxItems: 600 })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(600)
  @ValidateNested({ each: true })
  @Type(() => InspectReturnLineDto)
  lines!: InspectReturnLineDto[];
}
