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
import {
  ApiBearerAuth,
  ApiTags,
  ApiHeader,
  ApiOkResponse,
  ApiCreatedResponse,
} from '@nestjs/swagger';
import { CurrentAuthentication, Roles } from '../auth/decorators/access.js';
import type { AuthenticationContext } from '../auth/authenticated-user.js';
import { UserRole } from '../generated/prisma/client.js';
import { StorageLocationsService } from './storage-locations.service.js';
import {
  CreateStorageRowDto,
  CreateStorageShelfDto,
  UpdateStorageLocationDto,
} from './dto/storage-location.dto.js';
import { StockPlacementService } from '../inventory/stock-placement.service.js';
import { ReturnCustodyPlacementService } from '../inventory/return-custody-placement.service.js';
import {
  PlacementTransferDto,
  CustodyTransferDto,
} from '../inventory/dto/stock-placement.dto.js';
import {
  StorageRowsQueryDto,
  StorageShelvesQueryDto,
  StorageBalancesQueryDto,
  StorageHistoryQueryDto,
} from './dto/storage-location-query.dto.js';
import {
  CustodyBalancesResponseDto,
  CustodyTransferResultDto,
  StorageBalancesResponseDto,
  StorageEntriesResponseDto,
  StorageRowResponseDto,
  StorageRowsResponseDto,
  StorageShelfResponseDto,
  StorageShelvesResponseDto,
  StorageTransferResultDto,
  StorageTransfersResponseDto,
} from './dto/storage-location-response.dto.js';
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
  @Post('rows')
  @Roles(UserRole.ADMIN)
  @ApiCreatedResponse({ type: StorageRowResponseDto })
  createRow(
    @CurrentAuthentication() context: AuthenticationContext,
    @Body() input: CreateStorageRowDto,
  ) {
    return this.locations.createRow(context, input);
  }
  @Post('shelves')
  @Roles(UserRole.ADMIN)
  @ApiCreatedResponse({ type: StorageShelfResponseDto })
  createShelf(
    @CurrentAuthentication() context: AuthenticationContext,
    @Body() input: CreateStorageShelfDto,
  ) {
    return this.locations.createShelf(context, input);
  }
  @Patch('rows/:id')
  @Roles(UserRole.ADMIN)
  @ApiOkResponse({ type: StorageRowResponseDto })
  updateRow(
    @CurrentAuthentication() context: AuthenticationContext,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() input: UpdateStorageLocationDto,
  ) {
    return this.locations.update(context, id, input, 'ROW');
  }
  @Patch('shelves/:id')
  @Roles(UserRole.ADMIN)
  @ApiOkResponse({ type: StorageShelfResponseDto })
  updateShelf(
    @CurrentAuthentication() context: AuthenticationContext,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() input: UpdateStorageLocationDto,
  ) {
    return this.locations.update(context, id, input, 'SHELF');
  }
  @Get('rows')
  @ApiOkResponse({ type: StorageRowsResponseDto })
  rows(
    @CurrentAuthentication() context: AuthenticationContext,
    @Query() query: StorageRowsQueryDto,
  ) {
    return this.locations.rows(context, query);
  }
  @Get('shelves')
  @ApiOkResponse({ type: StorageShelvesResponseDto })
  shelves(
    @CurrentAuthentication() context: AuthenticationContext,
    @Query() query: StorageShelvesQueryDto,
  ) {
    return this.locations.shelves(context, query);
  }
  @Get('balances')
  @ApiOkResponse({ type: StorageBalancesResponseDto })
  balances(
    @CurrentAuthentication() context: AuthenticationContext,
    @Query() query: StorageBalancesQueryDto,
  ) {
    return this.locations.balances(context, query, 'AVAILABLE');
  }
  @Get('custody')
  @ApiOkResponse({ type: CustodyBalancesResponseDto })
  custodyBalances(
    @CurrentAuthentication() context: AuthenticationContext,
    @Query() query: StorageBalancesQueryDto,
  ) {
    return this.locations.balances(context, query, 'CUSTODY');
  }
  @Post('transfers')
  @Roles(UserRole.ADMIN, UserRole.WAREHOUSE_KEEPER)
  @ApiCreatedResponse({ type: StorageTransferResultDto })
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    schema: { type: 'string', format: 'uuid' },
  })
  transfer(
    @CurrentAuthentication() context: AuthenticationContext,
    @Headers('idempotency-key') key: string | undefined,
    @Body() input: PlacementTransferDto,
  ) {
    return this.placements.transfer(context, key, input);
  }
  @Post('custody-transfers')
  @Roles(UserRole.ADMIN, UserRole.WAREHOUSE_KEEPER)
  @ApiCreatedResponse({ type: CustodyTransferResultDto })
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    schema: { type: 'string', format: 'uuid' },
  })
  transferCustody(
    @CurrentAuthentication() context: AuthenticationContext,
    @Headers('idempotency-key') key: string | undefined,
    @Body() input: CustodyTransferDto,
  ) {
    return this.custody.transfer(context, key, input);
  }
  @Get('entries')
  @ApiOkResponse({ type: StorageEntriesResponseDto })
  entries(
    @CurrentAuthentication() context: AuthenticationContext,
    @Query() query: StorageHistoryQueryDto,
  ) {
    return this.locations.entries(context, query);
  }
  @Get('transfers')
  @ApiOkResponse({ type: StorageTransfersResponseDto })
  transfers(
    @CurrentAuthentication() context: AuthenticationContext,
    @Query() query: StorageHistoryQueryDto,
  ) {
    return this.locations.transfers(context, query);
  }
}
