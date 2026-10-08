import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class ListItemsDto {
  @ApiPropertyOptional({ default: 1, minimum: 1, maximum: 1000000 })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value,
  )
  @IsInt()
  @Min(1)
  @Max(1000000)
  page: number = 1;
  @ApiPropertyOptional({ default: 25, minimum: 1, maximum: 100 })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value,
  )
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 25;
  @ApiPropertyOptional({ type: Boolean })
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @Transform(({ value }: { value: unknown }) =>
    value === 'true' ? true : value === 'false' ? false : value,
  )
  @IsBoolean()
  isActive?: boolean;
  @ApiPropertyOptional({ maxLength: 150 })
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MaxLength(150)
  search?: string;
  @ApiPropertyOptional({ format: 'uuid' })
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsUUID('4')
  merchantId?: string;
}
