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
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { UserRole } from '../generated/prisma/client.js';
import { CurrentAuthentication, Roles } from '../auth/decorators/access.js';
import type { AuthenticationContext } from '../auth/authenticated-user.js';
import { ItemsService } from './items.service.js';
import { CreateItemDto } from './dto/create-item.dto.js';
import { UpdateItemDto } from './dto/update-item.dto.js';
import { ListItemsDto } from './dto/list-items.dto.js';
import { SetItemStatusDto } from './dto/set-item-status.dto.js';
import { ItemResponseDto } from './dto/item-response.dto.js';
import { ItemPageDto } from './dto/item-page.dto.js';
import { ItemLabelDto } from './dto/item-label.dto.js';
@ApiTags('Items catalog')
@ApiBearerAuth()
@ApiResponse({ status: 401, description: 'Invalid or revoked session' })
@ApiResponse({ status: 403, description: 'Role or merchant scope denied' })
@ApiResponse({
  status: 404,
  description: 'Item not found in the authorized scope',
})
@Roles(
  UserRole.ADMIN,
  UserRole.WAREHOUSE_KEEPER,
  UserRole.EMPLOYEE,
  UserRole.MERCHANT,
)
@Controller('items')
export class ItemsController {
  constructor(@Inject(ItemsService) private readonly items: ItemsService) {}
  @Post()
  @Roles(UserRole.ADMIN, UserRole.WAREHOUSE_KEEPER, UserRole.EMPLOYEE)
  @ApiCreatedResponse({ type: ItemResponseDto })
  create(
    @CurrentAuthentication() context: AuthenticationContext,
    @Body() input: CreateItemDto,
  ) {
    return this.items.create(context, input);
  }
  @Get()
  @ApiOkResponse({ type: ItemPageDto })
  list(
    @CurrentAuthentication() context: AuthenticationContext,
    @Query() query: ListItemsDto,
  ) {
    return this.items.list(context, query);
  }
  @Get('by-code/:code')
  @ApiOkResponse({ type: ItemResponseDto })
  byCode(
    @CurrentAuthentication() context: AuthenticationContext,
    @Param('code') code: string,
  ) {
    return this.items.byCode(context, code);
  }
  @Get(':id/label')
  @ApiOkResponse({ type: ItemLabelDto })
  label(
    @CurrentAuthentication() context: AuthenticationContext,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ) {
    return this.items.label(context, id);
  }
  @Get(':id')
  @ApiOkResponse({ type: ItemResponseDto })
  get(
    @CurrentAuthentication() context: AuthenticationContext,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ) {
    return this.items.get(context, id);
  }
  @Patch(':id')
  @Roles(UserRole.ADMIN)
  @ApiOkResponse({ type: ItemResponseDto })
  update(
    @CurrentAuthentication() context: AuthenticationContext,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() input: UpdateItemDto,
  ) {
    return this.items.update(context, id, input);
  }
  @Patch(':id/status')
  @Roles(UserRole.ADMIN)
  @ApiOkResponse({ type: ItemResponseDto })
  setStatus(
    @CurrentAuthentication() context: AuthenticationContext,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() input: SetItemStatusDto,
  ) {
    return this.items.setStatus(context, id, input.isActive);
  }
}
