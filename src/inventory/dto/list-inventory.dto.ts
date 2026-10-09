import { Transform } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsUUID,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { StockMovementKind } from '../../generated/prisma/client.js';
export class ListInventoryDto {
  @Transform(({ value }) =>
    typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value,
  )
  @IsInt()
  @Min(1)
  @Max(1_000_000)
  page = 1;
  @Transform(({ value }) =>
    typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value,
  )
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 25;
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID('4')
  merchantId?: string;
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID('4')
  itemId?: string;
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID('4')
  actorId?: string;
  @ApiPropertyOptional({ enum: StockMovementKind })
  @IsOptional()
  @IsEnum(StockMovementKind)
  kind?: StockMovementKind;
  @ApiPropertyOptional({ format: 'date-time' })
  @ValidateIf((_o, v) => v !== undefined)
  @IsDateString()
  from?: string;
  @ApiPropertyOptional({ format: 'date-time' })
  @ValidateIf((_o, v) => v !== undefined)
  @IsDateString()
  to?: string;
}
