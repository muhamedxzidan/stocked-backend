import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsEnum,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { UserRole } from '../../generated/prisma/client.js';
export class UpdateUserDto {
  @ApiPropertyOptional({ format: 'email', maxLength: 254 })
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsEmail()
  @MaxLength(254)
  email?: string;
  @ApiPropertyOptional({ minLength: 1, maxLength: 150 })
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(1)
  @MaxLength(150)
  displayName?: string;
  @ApiPropertyOptional({ enum: UserRole })
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsEnum(UserRole)
  role?: UserRole;
  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true })
  @ValidateIf(
    (_object, value: unknown) => value !== undefined && value !== null,
  )
  @IsUUID('4')
  merchantId?: string | null;
}
