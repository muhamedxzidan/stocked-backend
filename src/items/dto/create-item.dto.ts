import { Transform } from 'class-transformer';
import {
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
export class CreateItemDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID('4') merchantId: string;
  @ApiProperty({ type: String, maxLength: 200, nullable: false })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name: string;
  @ApiProperty({ type: String, maxLength: 100, nullable: true })
  @ValidateIf((_object, value: unknown) => value !== null)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  brand: string | null;
  @ApiProperty({ type: String, maxLength: 100, nullable: true })
  @ValidateIf((_object, value: unknown) => value !== null)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  color: string | null;
  @ApiProperty({
    type: String,
    example: '0.250',
    pattern: '^(?!0(?:\\.0{1,3})?$)(?:0|[1-9][0-9]{0,8})(?:\\.[0-9]{1,3})?$',
  })
  @IsString()
  @Matches(/^(?!0(?:\.0{1,3})?$)(?:0|[1-9][0-9]{0,8})(?:\.[0-9]{1,3})?$/)
  weightKg: string;
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
