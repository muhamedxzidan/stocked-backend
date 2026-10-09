import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { UserRole } from '../generated/prisma/client.js';
import { CurrentAuthentication, Roles } from '../auth/decorators/access.js';
import type { AuthenticationContext } from '../auth/authenticated-user.js';
import {
  ApproveStocktakeDto,
  ListStocktakesDto,
  OpenStocktakeDto,
  RecordStocktakeCountDto,
  StocktakeAttendanceDto,
  StocktakeLinesQueryDto,
  StocktakeNotesDto,
} from './dto/stocktake.dto.js';
import { StocktakeOpeningService } from './stocktake-opening.service.js';
import { StocktakeCountingService } from './stocktake-counting.service.js';
import { StocktakeApprovalService } from './stocktake-approval.service.js';
import { StocktakeCancellationService } from './stocktake-cancellation.service.js';
import { StocktakesReadService } from './stocktakes-read.service.js';
@ApiTags('Stocktakes')
@ApiBearerAuth()
@Roles(UserRole.ADMIN, UserRole.WAREHOUSE_KEEPER)
@Controller('stocktakes')
export class StocktakesController {
  constructor(
    @Inject(StocktakeOpeningService)
    private readonly opening: StocktakeOpeningService,
    @Inject(StocktakeCountingService)
    private readonly counting: StocktakeCountingService,
    @Inject(StocktakeApprovalService)
    private readonly approval: StocktakeApprovalService,
    @Inject(StocktakeCancellationService)
    private readonly cancellation: StocktakeCancellationService,
    @Inject(StocktakesReadService)
    private readonly reads: StocktakesReadService,
  ) {}
  @Post() @HttpCode(200) open(
    @CurrentAuthentication() c: AuthenticationContext,
    @Headers('idempotency-key') key: string | undefined,
    @Body() i: OpenStocktakeDto,
  ) {
    return this.opening.open(c, key, i);
  }
  @Post(':id/counts') @HttpCode(200) count(
    @CurrentAuthentication() c: AuthenticationContext,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Headers('idempotency-key') key: string | undefined,
    @Body() i: RecordStocktakeCountDto,
  ) {
    return this.counting.count(c, id, key, i);
  }
  @Post(':id/attendance') @HttpCode(200) attendance(
    @CurrentAuthentication() c: AuthenticationContext,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Headers('idempotency-key') key: string | undefined,
    @Body() i: StocktakeAttendanceDto,
  ) {
    return this.counting.attendance(c, id, key, i);
  }
  @Post(':id/notes') @HttpCode(200) note(
    @CurrentAuthentication() c: AuthenticationContext,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Headers('idempotency-key') key: string | undefined,
    @Body() i: StocktakeNotesDto,
  ) {
    return this.counting.transition(c, id, key, i, 'NOTED');
  }
  @Post(':id/submit') @HttpCode(200) submit(
    @CurrentAuthentication() c: AuthenticationContext,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Headers('idempotency-key') key: string | undefined,
    @Body() i: StocktakeNotesDto,
  ) {
    return this.counting.transition(c, id, key, i, 'SUBMITTED');
  }
  @Post(':id/reopen') @HttpCode(200) @Roles(UserRole.ADMIN) reopen(
    @CurrentAuthentication() c: AuthenticationContext,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Headers('idempotency-key') key: string | undefined,
    @Body() i: StocktakeNotesDto,
  ) {
    return this.counting.transition(c, id, key, i, 'REOPENED');
  }
  @Post(':id/approve') @HttpCode(200) @Roles(UserRole.ADMIN) approve(
    @CurrentAuthentication() c: AuthenticationContext,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Headers('idempotency-key') key: string | undefined,
    @Body() i: ApproveStocktakeDto,
  ) {
    return this.approval.approve(c, id, key, i);
  }
  @Post(':id/cancel') @HttpCode(200) @Roles(UserRole.ADMIN) cancel(
    @CurrentAuthentication() c: AuthenticationContext,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Headers('idempotency-key') key: string | undefined,
    @Body() i: StocktakeNotesDto,
  ) {
    return this.cancellation.cancel(c, id, key, i);
  }
  @Get()
  @Roles(
    UserRole.ADMIN,
    UserRole.WAREHOUSE_KEEPER,
    UserRole.EMPLOYEE,
    UserRole.MERCHANT,
  )
  list(
    @CurrentAuthentication() c: AuthenticationContext,
    @Query() q: ListStocktakesDto,
  ) {
    return this.reads.list(c, q);
  }
  @Get(':id')
  @Roles(
    UserRole.ADMIN,
    UserRole.WAREHOUSE_KEEPER,
    UserRole.EMPLOYEE,
    UserRole.MERCHANT,
  )
  get(
    @CurrentAuthentication() c: AuthenticationContext,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ) {
    return this.reads.get(c, id);
  }
  @Get(':id/lines')
  @Roles(
    UserRole.ADMIN,
    UserRole.WAREHOUSE_KEEPER,
    UserRole.EMPLOYEE,
    UserRole.MERCHANT,
  )
  lines(
    @CurrentAuthentication() c: AuthenticationContext,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Query() q: StocktakeLinesQueryDto,
  ) {
    return this.reads.lines(c, id, q);
  }
  @Get(':id/scopes')
  @Roles(
    UserRole.ADMIN,
    UserRole.WAREHOUSE_KEEPER,
    UserRole.EMPLOYEE,
    UserRole.MERCHANT,
  )
  scopes(
    @CurrentAuthentication() c: AuthenticationContext,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Query() q: ListStocktakesDto,
  ) {
    return this.reads.scopes(c, id, q);
  }
  @Get(':id/events')
  @Roles(UserRole.ADMIN, UserRole.WAREHOUSE_KEEPER, UserRole.EMPLOYEE)
  events(
    @CurrentAuthentication() c: AuthenticationContext,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Query() q: ListStocktakesDto,
  ) {
    return this.reads.events(c, id, q);
  }
}
