import { ApiProperty } from '@nestjs/swagger';
import { UserResponseDto } from './user-response.dto.js';
export class UserPageDto {
  @ApiProperty({ type: [UserResponseDto] }) items: UserResponseDto[];
  @ApiProperty() total: number;
  @ApiProperty() page: number;
  @ApiProperty() limit: number;
}
