import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiTags,
  ApiResponse,
} from '@nestjs/swagger';
import { UserRole } from '../generated/prisma/client.js';
import { CurrentAuthentication, Roles } from '../auth/decorators/access.js';
import type { AuthenticationContext } from '../auth/authenticated-user.js';
import { UsersService } from './users.service.js';
import { CreateUserDto } from './dto/create-user.dto.js';
import { UpdateUserDto } from './dto/update-user.dto.js';
import { SetUserStatusDto } from './dto/set-user-status.dto.js';
import { ListUsersDto } from './dto/list-users.dto.js';
import { UserResponseDto } from './dto/user-response.dto.js';
import { UserPageDto } from './dto/user-page.dto.js';

@ApiTags('Users administration')
@ApiBearerAuth()
@ApiResponse({ status: 401, description: 'Invalid or revoked session' })
@ApiResponse({
  status: 403,
  description: 'Requires an administrator with a completed password change',
})
@ApiResponse({
  status: 409,
  description: 'Duplicate value or protected identity rule',
})
@Roles(UserRole.ADMIN)
@Controller('users')
export class UsersController {
  constructor(@Inject(UsersService) private readonly users: UsersService) {}
  @Post()
  @ApiCreatedResponse({ type: UserResponseDto })
  create(
    @CurrentAuthentication() context: AuthenticationContext,
    @Body() input: CreateUserDto,
  ) {
    return this.users.create(context, input);
  }
  @Get()
  @ApiOkResponse({ type: UserPageDto })
  list(@Query() query: ListUsersDto) {
    return this.users.list(query);
  }
  @Get(':id')
  @ApiOkResponse({ type: UserResponseDto })
  get(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    return this.users.get(id);
  }
  @Patch(':id')
  @ApiOkResponse({ type: UserResponseDto })
  update(
    @CurrentAuthentication() context: AuthenticationContext,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() input: UpdateUserDto,
  ) {
    return this.users.update(context, id, input);
  }
  @Patch(':id/status')
  @ApiOkResponse({ type: UserResponseDto })
  setStatus(
    @CurrentAuthentication() context: AuthenticationContext,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() input: SetUserStatusDto,
  ) {
    return this.users.setStatus(context, id, input.isActive);
  }
}
