import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiTags,
  ApiOkResponse,
  ApiNoContentResponse,
  ApiUnauthorizedResponse,
  ApiResponse,
} from '@nestjs/swagger';
import { AuthService } from './auth.service.js';
import { AccountResponseDto } from './dto/account-response.dto.js';
import { SessionResponseDto } from './dto/session-response.dto.js';
import { LoginDto } from './dto/login.dto.js';
import { ChangePasswordDto } from './dto/change-password.dto.js';
import { LoginAttemptsGuard } from './guards/login-attempts.guard.js';
import {
  Authenticated,
  AllowPasswordChangeSession,
  CurrentAuthentication,
  Public,
} from './decorators/access.js';
import type { AuthenticationContext } from './authenticated-user.js';

@ApiTags('Authentication')
@ApiUnauthorizedResponse({
  description: 'Invalid credentials or expired/revoked session',
})
@Controller('auth')
export class AuthController {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}
  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @UseGuards(LoginAttemptsGuard)
  @ApiOperation({
    summary: 'Sign in; limited sessions require changing the password',
  })
  @ApiOkResponse({ type: SessionResponseDto })
  @ApiResponse({
    status: 429,
    description: 'Too many attempts; Retry-After gives seconds to wait',
  })
  login(@Body() input: LoginDto) {
    return this.auth.login(input);
  }
  @Authenticated()
  @AllowPasswordChangeSession()
  @ApiBearerAuth()
  @Get('me')
  @ApiOkResponse({ type: AccountResponseDto })
  me(@CurrentAuthentication() context: AuthenticationContext) {
    return context.user;
  }
  @Authenticated()
  @AllowPasswordChangeSession()
  @ApiBearerAuth()
  @Post('change-password')
  @HttpCode(HttpStatus.OK)
  @UseGuards(LoginAttemptsGuard)
  @ApiOkResponse({ type: SessionResponseDto })
  changePassword(
    @CurrentAuthentication() context: AuthenticationContext,
    @Body() input: ChangePasswordDto,
  ) {
    return this.auth.changePassword(context, input);
  }
  @Authenticated()
  @AllowPasswordChangeSession()
  @ApiBearerAuth()
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse({ description: 'Current server-side session revoked' })
  async logout(
    @CurrentAuthentication() context: AuthenticationContext,
  ): Promise<void> {
    await this.auth.logout(context);
  }
}
