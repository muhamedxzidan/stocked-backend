import {
  InventoryBalanceResponseDto,
  InventoryBalancesResponseDto,
  InventoryMovementResponseDto,
  InventoryMovementsResponseDto,
} from './dto/inventory-response.dto.js';
import {
  Controller,
  Get,
  Inject,
  Param,
  ParseUUIDPipe,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { UserRole } from '../generated/prisma/client.js';
import { CurrentAuthentication, Roles } from '../auth/decorators/access.js';
import type { AuthenticationContext } from '../auth/authenticated-user.js';
import { InventoryService } from './inventory.service.js';
import { ListInventoryDto } from './dto/list-inventory.dto.js';
@ApiTags('Inventory')
@ApiBearerAuth()
@Roles(
  UserRole.ADMIN,
  UserRole.WAREHOUSE_KEEPER,
  UserRole.EMPLOYEE,
  UserRole.MERCHANT,
)
@Controller()
export class InventoryController {
  constructor(
    @Inject(InventoryService) private readonly inventory: InventoryService,
  ) {}
  @Get('balances')
  @ApiOkResponse({ type: InventoryBalancesResponseDto })
  balances(
    @CurrentAuthentication() context: AuthenticationContext,
    @Query() query: ListInventoryDto,
  ) {
    return this.inventory.balances(context, query);
  }
  @Get('balances/:itemId')
  @ApiOkResponse({ type: InventoryBalanceResponseDto })
  balance(
    @CurrentAuthentication() context: AuthenticationContext,
    @Param('itemId', new ParseUUIDPipe({ version: '4' })) itemId: string,
  ) {
    return this.inventory.balance(context, itemId);
  }
  @Get('movements')
  @ApiOkResponse({ type: InventoryMovementsResponseDto })
  movements(
    @CurrentAuthentication() context: AuthenticationContext,
    @Query() query: ListInventoryDto,
  ) {
    return this.inventory.movements(context, query);
  }
  @Get('movements/:id')
  @ApiOkResponse({ type: InventoryMovementResponseDto })
  movement(
    @CurrentAuthentication() context: AuthenticationContext,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ) {
    return this.inventory.movement(context, id);
  }
}
