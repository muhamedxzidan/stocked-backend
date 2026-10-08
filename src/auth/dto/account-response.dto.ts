import { ApiProperty } from '@nestjs/swagger';
import { UserRole } from '../../generated/prisma/client.js';
export class AccountResponseDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ format: 'email' }) email: string;
  @ApiProperty() displayName: string;
  @ApiProperty({ enum: UserRole }) role: UserRole;
  @ApiProperty({ type: String, format: 'uuid', nullable: true }) merchantId:
    string | null;
  @ApiProperty() mustChangePassword: boolean;
}
