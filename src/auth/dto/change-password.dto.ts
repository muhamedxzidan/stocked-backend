import { IsString, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
export class ChangePasswordDto {
  @ApiProperty({ format: 'password', maxLength: 256 })
  @IsString()
  @MaxLength(256)
  currentPassword: string;
  @ApiProperty({
    format: 'password',
    description: '15–128 Unicode code points; common passwords rejected',
    maxLength: 256,
  })
  @IsString()
  @MaxLength(256)
  newPassword: string;
}
