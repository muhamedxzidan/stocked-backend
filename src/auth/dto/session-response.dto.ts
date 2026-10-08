import { ApiProperty } from '@nestjs/swagger';
import { AccountResponseDto } from './account-response.dto.js';
export class SessionResponseDto {
  @ApiProperty({
    description: 'Opaque secret; returned once and never stored as plaintext',
    minLength: 43,
    maxLength: 43,
  })
  token: string;
  @ApiProperty({ enum: ['Bearer'] }) tokenType: 'Bearer';
  @ApiProperty({ type: String, format: 'date-time' }) expiresAt: Date;
  @ApiProperty({ type: AccountResponseDto }) user: AccountResponseDto;
}
