import { ApiProperty } from '@nestjs/swagger';
import { UserRole } from '../../generated/prisma/client.js';
export class UserResponseDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ format: 'email' }) email: string;
  @ApiProperty({}) displayName: string;
  @ApiProperty({ enum: UserRole }) role: UserRole;
  @ApiProperty({ type: String, format: 'uuid', nullable: true }) merchantId:
    string | null;
  @ApiProperty({}) isActive: boolean;
  @ApiProperty({}) mustChangePassword: boolean;
  @ApiProperty({ type: String, format: 'uuid', nullable: true }) createdById:
    string | null;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt: Date;
  @ApiProperty({ type: String, format: 'date-time' }) updatedAt: Date;
}
