import { Transform } from 'class-transformer';
import {
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
export class UpdateItemDto {
  @ApiPropertyOptional({ type: String, maxLength: 200, nullable: false })
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name?: string;
  @ApiPropertyOptional({ type: String, maxLength: 100, nullable: true })
  @ValidateIf(
    (_object, value: unknown) => value !== undefined && value !== null,
  )
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  brand?: string | null;
  @ApiPropertyOptional({ type: String, maxLength: 100, nullable: true })
  @ValidateIf(
    (_object, value: unknown) => value !== undefined && value !== null,
  )
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  color?: string | null;
  @ApiPropertyOptional({
    type: String,
    example: '0.250',
    pattern: '^(?!0(?:\\.0{1,3})?$)(?:0|[1-9][0-9]{0,8})(?:\\.[0-9]{1,3})?$',
  })
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsString()
  @Matches(/^(?!0(?:\.0{1,3})?$)(?:0|[1-9][0-9]{0,8})(?:\.[0-9]{1,3})?$/)
  weightKg?: string;
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 2000 })
  @ValidateIf(
    (_object, value: unknown) => value !== undefined && value !== null,
  )
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  notes?: string | null;
}
