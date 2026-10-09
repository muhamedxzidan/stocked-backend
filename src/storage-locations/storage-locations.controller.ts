import {
  Body,
  Controller,
  Get,
  Headers,
  Inject,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentAuthentication, Roles } from '../auth/decorators/access.js';
import type { AuthenticationContext } from '../auth/authenticated-user.js';
import { UserRole } from '../generated/prisma/client.js';
import { StorageLocationsService } from './storage-locations.service.js';
import {
  CreateStorageRowDto,
  CreateStorageShelfDto,
  ListStorageLocationsDto,
  UpdateStorageLocationDto,
} from './dto/storage-location.dto.js';
import { StockPlacementService } from '../inventory/stock-placement.service.js';
import { ReturnCustodyPlacementService } from '../inventory/return-custody-placement.service.js';
import {
  PlacementTransferDto,
  CustodyTransferDto,
} from '../inventory/dto/stock-placement.dto.js';
@ApiTags('Storage locations')
@ApiBearerAuth()
@Roles(
  UserRole.ADMIN,
  UserRole.WAREHOUSE_KEEPER,
  UserRole.EMPLOYEE,
  UserRole.MERCHANT,
)
@Controller('storage-locations')
export class StorageLocationsController {
  constructor(
    @Inject(StorageLocationsService)
    private readonly locations: StorageLocationsService,
    @Inject(StockPlacementService)
    private readonly placements: StockPlacementService,
    @Inject(ReturnCustodyPlacementService)
    private readonly custody: ReturnCustodyPlacementService,
  ) {}
  @Post('rows') @Roles(UserRole.ADMIN) createRow(
    @CurrentAuthentication() c: AuthenticationContext,
    @Body() i: CreateStorageRowDto,
  ) {
    return this.locations.createRow(c, i);
  }
  @Post('shelves') @Roles(UserRole.ADMIN) createShelf(
    @CurrentAuthentication() c: AuthenticationContext,
    @Body() i: CreateStorageShelfDto,
  ) {
    return this.locations.createShelf(c, i);
  }
  @Patch('rows/:id') @Roles(UserRole.ADMIN) updateRow(
    @CurrentAuthentication() c: AuthenticationContext,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() i: UpdateStorageLocationDto,
  ) {
    return this.locations.update(c, id, i, 'ROW');
  }
  @Patch('shelves/:id') @Roles(UserRole.ADMIN) updateShelf(
    @CurrentAuthentication() c: AuthenticationContext,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() i: UpdateStorageLocationDto,
  ) {
    return this.locations.update(c, id, i, 'SHELF');
  }
  @Get('rows') rows(
    @CurrentAuthentication() c: AuthenticationContext,
    @Query() q: ListStorageLocationsDto,
  ) {
    return this.locations.rows(c, q);
  }
  @Get('shelves') shelves(
    @CurrentAuthentication() c: AuthenticationContext,
    @Query() q: ListStorageLocationsDto,
  ) {
    return this.locations.shelves(c, q);
  }
  @Get('balances') balances(
    @CurrentAuthentication() c: AuthenticationContext,
    @Query() q: ListStorageLocationsDto,
  ) {
    return this.locations.balances(c, q, 'AVAILABLE');
  }
  @Get('custody') custodyBalances(
    @CurrentAuthentication() c: AuthenticationContext,
    @Query() q: ListStorageLocationsDto,
  ) {
    return this.locations.balances(c, q, 'CUSTODY');
  }
  @Post('transfers') @Roles(UserRole.ADMIN, UserRole.WAREHOUSE_KEEPER) transfer(
    @CurrentAuthentication() c: AuthenticationContext,
    @Headers('idempotency-key') key: string | undefined,
    @Body() i: PlacementTransferDto,
  ) {
    return this.placements.transfer(c, key, i);
  }
  @Post('custody-transfers')
  @Roles(UserRole.ADMIN, UserRole.WAREHOUSE_KEEPER)
  transferCustody(
    @CurrentAuthentication() c: AuthenticationContext,
    @Headers('idempotency-key') key: string | undefined,
    @Body() i: CustodyTransferDto,
  ) {
    return this.custody.transfer(c, key, i);
  }
  @Get('entries')
  entries(
    @CurrentAuthentication() c: AuthenticationContext,
    @Query() q: ListStorageLocationsDto,
  ) {
    return this.locations.entries(c, q);
  }
  @Get('transfers')
  transfers(
    @CurrentAuthentication() c: AuthenticationContext,
    @Query() q: ListStorageLocationsDto,
  ) {
    return this.locations.transfers(c, q);
  }
}
