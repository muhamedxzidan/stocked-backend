import {
  ListStocktakesDto,
  StocktakeLinesQueryDto,
  StocktakeScopesQueryDto,
  StocktakeEventsQueryDto,
} from './dto/stocktake-query.dto.js';
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
import {
  ApiBearerAuth,
  ApiTags,
  ApiHeader,
  ApiOkResponse,
  ApiExtraModels,
  getSchemaPath,
} from '@nestjs/swagger';
import { UserRole } from '../generated/prisma/client.js';
import { CurrentAuthentication, Roles } from '../auth/decorators/access.js';
import type { AuthenticationContext } from '../auth/authenticated-user.js';
import {
  ApproveStocktakeDto,
  OpenStocktakeDto,
  RecordStocktakeCountDto,
  StocktakeAttendanceDto,
  StocktakeNotesDto,
} from './dto/stocktake.dto.js';
import { StocktakeOpeningService } from './stocktake-opening.service.js';
import { StocktakeCountingService } from './stocktake-counting.service.js';
import { StocktakeApprovalService } from './stocktake-approval.service.js';
import { StocktakeCancellationService } from './stocktake-cancellation.service.js';
import { StocktakesReadService } from './stocktakes-read.service.js';
import {
  StocktakeCommandResponseDto,
  StocktakeStaffResponseDto,
  StocktakeMerchantResponseDto,
  StocktakesStaffResponseDto,
  StocktakesMerchantResponseDto,
  StocktakeStaffLinesResponseDto,
  StocktakeMerchantLinesResponseDto,
  StocktakeScopesResponseDto,
  StocktakeEventsResponseDto,
} from './dto/stocktake-response.dto.js';
@ApiExtraModels(
  StocktakeCommandResponseDto,
  StocktakeStaffResponseDto,
  StocktakeMerchantResponseDto,
  StocktakesStaffResponseDto,
  StocktakesMerchantResponseDto,
  StocktakeStaffLinesResponseDto,
  StocktakeMerchantLinesResponseDto,
  StocktakeScopesResponseDto,
  StocktakeEventsResponseDto,
)
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
  @Post()
  @HttpCode(200)
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    schema: { type: 'string', format: 'uuid' },
  })
  @ApiOkResponse({ type: StocktakeCommandResponseDto })
  open(
    @CurrentAuthentication() context: AuthenticationContext,
    @Headers('idempotency-key') key: string | undefined,
    @Body() input: OpenStocktakeDto,
  ) {
    return this.opening.open(context, key, input);
  }
  @Post(':id/counts')
  @HttpCode(200)
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    schema: { type: 'string', format: 'uuid' },
  })
  @ApiOkResponse({ type: StocktakeCommandResponseDto })
  count(
    @CurrentAuthentication() context: AuthenticationContext,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Headers('idempotency-key') key: string | undefined,
    @Body() input: RecordStocktakeCountDto,
  ) {
    return this.counting.count(context, id, key, input);
  }
  @Post(':id/attendance')
  @HttpCode(200)
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    schema: { type: 'string', format: 'uuid' },
  })
  @ApiOkResponse({ type: StocktakeCommandResponseDto })
  attendance(
    @CurrentAuthentication() context: AuthenticationContext,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Headers('idempotency-key') key: string | undefined,
    @Body() input: StocktakeAttendanceDto,
  ) {
    return this.counting.attendance(context, id, key, input);
  }
  @Post(':id/notes')
  @HttpCode(200)
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    schema: { type: 'string', format: 'uuid' },
  })
  @ApiOkResponse({ type: StocktakeCommandResponseDto })
  note(
    @CurrentAuthentication() context: AuthenticationContext,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Headers('idempotency-key') key: string | undefined,
    @Body() input: StocktakeNotesDto,
  ) {
    return this.counting.transition(context, id, key, input, 'NOTED');
  }
  @Post(':id/submit')
  @HttpCode(200)
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    schema: { type: 'string', format: 'uuid' },
  })
  @ApiOkResponse({ type: StocktakeCommandResponseDto })
  submit(
    @CurrentAuthentication() context: AuthenticationContext,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Headers('idempotency-key') key: string | undefined,
    @Body() input: StocktakeNotesDto,
  ) {
    return this.counting.transition(context, id, key, input, 'SUBMITTED');
  }
  @Post(':id/reopen')
  @HttpCode(200)
  @Roles(UserRole.ADMIN)
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    schema: { type: 'string', format: 'uuid' },
  })
  @ApiOkResponse({ type: StocktakeCommandResponseDto })
  reopen(
    @CurrentAuthentication() context: AuthenticationContext,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Headers('idempotency-key') key: string | undefined,
    @Body() input: StocktakeNotesDto,
  ) {
    return this.counting.transition(context, id, key, input, 'REOPENED');
  }
  @Post(':id/approve')
  @HttpCode(200)
  @Roles(UserRole.ADMIN)
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    schema: { type: 'string', format: 'uuid' },
  })
  @ApiOkResponse({ type: StocktakeCommandResponseDto })
  approve(
    @CurrentAuthentication() context: AuthenticationContext,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Headers('idempotency-key') key: string | undefined,
    @Body() input: ApproveStocktakeDto,
  ) {
    return this.approval.approve(context, id, key, input);
  }
  @Post(':id/cancel')
  @HttpCode(200)
  @Roles(UserRole.ADMIN)
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    schema: { type: 'string', format: 'uuid' },
  })
  @ApiOkResponse({ type: StocktakeCommandResponseDto })
  cancel(
    @CurrentAuthentication() context: AuthenticationContext,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Headers('idempotency-key') key: string | undefined,
    @Body() input: StocktakeNotesDto,
  ) {
    return this.cancellation.cancel(context, id, key, input);
  }
  @Get()
  @Roles(
    UserRole.ADMIN,
    UserRole.WAREHOUSE_KEEPER,
    UserRole.EMPLOYEE,
    UserRole.MERCHANT,
  )
  @ApiOkResponse({
    description:
      'Staff receive the full representation; merchants receive only their scoped representation.',
    schema: {
      anyOf: [
        { $ref: getSchemaPath(StocktakesStaffResponseDto) },
        { $ref: getSchemaPath(StocktakesMerchantResponseDto) },
      ],
    },
  })
  list(
    @CurrentAuthentication() context: AuthenticationContext,
    @Query() query: ListStocktakesDto,
  ) {
    return this.reads.list(context, query);
  }
  @Get(':id')
  @Roles(
    UserRole.ADMIN,
    UserRole.WAREHOUSE_KEEPER,
    UserRole.EMPLOYEE,
    UserRole.MERCHANT,
  )
  @ApiOkResponse({
    description:
      'Staff receive the full representation; merchants receive only their scoped representation.',
    schema: {
      anyOf: [
        { $ref: getSchemaPath(StocktakeStaffResponseDto) },
        { $ref: getSchemaPath(StocktakeMerchantResponseDto) },
      ],
    },
  })
  get(
    @CurrentAuthentication() context: AuthenticationContext,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ) {
    return this.reads.get(context, id);
  }
  @Get(':id/lines')
  @Roles(
    UserRole.ADMIN,
    UserRole.WAREHOUSE_KEEPER,
    UserRole.EMPLOYEE,
    UserRole.MERCHANT,
  )
  @ApiOkResponse({
    description:
      'Staff receive the full representation; merchants receive only their scoped representation.',
    schema: {
      anyOf: [
        { $ref: getSchemaPath(StocktakeStaffLinesResponseDto) },
        { $ref: getSchemaPath(StocktakeMerchantLinesResponseDto) },
      ],
    },
  })
  lines(
    @CurrentAuthentication() context: AuthenticationContext,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Query() query: StocktakeLinesQueryDto,
  ) {
    return this.reads.lines(context, id, query);
  }
  @Get(':id/scopes')
  @Roles(
    UserRole.ADMIN,
    UserRole.WAREHOUSE_KEEPER,
    UserRole.EMPLOYEE,
    UserRole.MERCHANT,
  )
  @ApiOkResponse({ type: StocktakeScopesResponseDto })
  scopes(
    @CurrentAuthentication() context: AuthenticationContext,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Query() query: StocktakeScopesQueryDto,
  ) {
    return this.reads.scopes(context, id, query);
  }
  @Get(':id/events')
  @Roles(UserRole.ADMIN, UserRole.WAREHOUSE_KEEPER, UserRole.EMPLOYEE)
  @ApiOkResponse({ type: StocktakeEventsResponseDto })
  events(
    @CurrentAuthentication() context: AuthenticationContext,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Query() query: StocktakeEventsQueryDto,
  ) {
    return this.reads.events(context, id, query);
  }
}
