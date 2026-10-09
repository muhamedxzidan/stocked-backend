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
import { MerchantsService } from './merchants.service.js';
import { CreateMerchantDto } from './dto/create-merchant.dto.js';
import { UpdateMerchantDto } from './dto/update-merchant.dto.js';
import { SetMerchantStatusDto } from './dto/set-merchant-status.dto.js';
import { ListMerchantsDto } from './dto/list-merchants.dto.js';
import { MerchantResponseDto } from './dto/merchant-response.dto.js';
import { MerchantPageDto } from './dto/merchant-page.dto.js';

@ApiTags('Merchants administration')
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
@Controller('merchants')
export class MerchantsController {
  constructor(
    @Inject(MerchantsService) private readonly merchants: MerchantsService,
  ) {}
  @Post()
  @ApiCreatedResponse({ type: MerchantResponseDto })
  create(
    @CurrentAuthentication() context: AuthenticationContext,
    @Body() input: CreateMerchantDto,
  ) {
    return this.merchants.create(context, input);
  }
  @Get()
  @ApiOkResponse({ type: MerchantPageDto })
  list(@Query() query: ListMerchantsDto) {
    return this.merchants.list(query);
  }
  @Get(':id')
  @ApiOkResponse({ type: MerchantResponseDto })
  get(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    return this.merchants.get(id);
  }
  @Patch(':id')
  @ApiOkResponse({ type: MerchantResponseDto })
  update(
    @CurrentAuthentication() context: AuthenticationContext,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() input: UpdateMerchantDto,
  ) {
    return this.merchants.update(context, id, input);
  }
  @Patch(':id/status')
  @ApiOkResponse({ type: MerchantResponseDto })
  setStatus(
    @CurrentAuthentication() context: AuthenticationContext,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() input: SetMerchantStatusDto,
  ) {
    return this.merchants.setStatus(context, id, input.isActive, input.reason);
  }
}
