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
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { UserRole } from '../../generated/prisma/client.js';
export class CreateUserDto {
  @ApiProperty({ format: 'email', maxLength: 254 })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsEmail()
  @MaxLength(254)
  email: string;
  @ApiProperty({ minLength: 1, maxLength: 150 })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(1)
  @MaxLength(150)
  displayName: string;
  @ApiProperty({
    format: 'password',
    description: '15–128 Unicode characters; never returned',
  })
  @IsString()
  @MaxLength(256)
  initialPassword: string;
  @ApiProperty({ enum: UserRole }) @IsEnum(UserRole) role: UserRole;
  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true })
  @ValidateIf(
    (_object, value: unknown) => value !== undefined && value !== null,
  )
  @IsUUID('4')
  merchantId?: string | null;
}
