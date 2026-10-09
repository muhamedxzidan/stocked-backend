import {
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
export class ShelfQuantityDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID('4') shelfId!: string;
  @ApiProperty({ minimum: 1, maximum: 2147483647 })
  @IsInt()
  @Min(1)
  @Max(2147483647)
  quantity!: number;
}
export class ItemShelfQuantityDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID('4') shelfId!: string;
  @ApiProperty({ minimum: 1, maximum: 2147483647 })
  @IsInt()
  @Min(1)
  @Max(2147483647)
  quantity!: number;
  @ApiProperty({ format: 'uuid' }) @IsUUID('4') itemId!: string;
}
export class PlacementTransferDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID('4') itemId!: string;
  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  @IsOptional()
  @IsUUID('4')
  fromShelfId?: string | null;
  @ApiProperty({ format: 'uuid' }) @IsUUID('4') toShelfId!: string;
  @ApiProperty({ minimum: 1, maximum: 2147483647 })
  @IsInt()
  @Min(1)
  @Max(2147483647)
  quantity!: number;
  @ApiProperty({ minLength: 10, maxLength: 2000 })
  @IsString()
  @MinLength(10)
  @MaxLength(2000)
  reason!: string;
}
export class CustodyTransferDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID('4') receiptLineId!: string;
  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  @IsOptional()
  @IsUUID('4')
  fromShelfId?: string | null;
  @ApiProperty({ format: 'uuid' }) @IsUUID('4') toShelfId!: string;
  @ApiProperty({ minimum: 1, maximum: 1000000 })
  @IsInt()
  @Min(1)
  @Max(1000000)
  quantity!: number;
  @ApiProperty({ minLength: 10, maxLength: 2000 })
  @IsString()
  @MinLength(10)
  @MaxLength(2000)
  reason!: string;
}
