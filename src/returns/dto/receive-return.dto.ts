import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { ShelfQuantityDto } from '../../inventory/dto/stock-placement.dto.js';

export class ReceiveReturnLineDto {
  @ApiPropertyOptional({ type: [ShelfQuantityDto] })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => ShelfQuantityDto)
  placements?: ShelfQuantityDto[];

  @ApiProperty({ format: 'uuid' }) @IsUUID('4') shipmentLineId!: string;
  @ApiProperty({ minimum: 1, maximum: 1000000 })
  @IsInt()
  @Min(1)
  @Max(1000000)
  quantity!: number;
}
export class ReceiveReturnDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID('4') merchantId!: string;
  @ApiProperty({ format: 'uuid' }) @IsUUID('4') shipmentId!: string;
  @ApiPropertyOptional({ nullable: true, maxLength: 2000 })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MaxLength(2000)
  notes?: string | null;
  @ApiProperty({ type: [ReceiveReturnLineDto], minItems: 1, maxItems: 100 })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => ReceiveReturnLineDto)
  lines!: ReceiveReturnLineDto[];
}
