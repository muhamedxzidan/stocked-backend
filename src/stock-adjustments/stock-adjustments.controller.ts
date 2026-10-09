import {
  Body,
  Controller,
  Get,
  Headers,
  HttpStatus,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';
import { UserRole } from '../generated/prisma/client.js';
import { CurrentAuthentication, Roles } from '../auth/decorators/access.js';
import type { AuthenticationContext } from '../auth/authenticated-user.js';
import { CreateAdjustmentDto } from './dto/create-adjustment.dto.js';
import { ListAdjustmentsDto } from './dto/list-adjustments.dto.js';
import { StockAdjustmentsService } from './stock-adjustments.service.js';
@ApiTags('Stock adjustments')
@ApiBearerAuth()
@Roles(
  UserRole.ADMIN,
  UserRole.WAREHOUSE_KEEPER,
  UserRole.EMPLOYEE,
  UserRole.MERCHANT,
)
@Controller('stock-adjustments')
export class StockAdjustmentsController {
  constructor(
    @Inject(StockAdjustmentsService)
    private readonly adjustments: StockAdjustmentsService,
  ) {}
  @Post()
  @Roles(UserRole.ADMIN)
  @ApiCreatedResponse()
  async create(
    @CurrentAuthentication() context: AuthenticationContext,
    @Headers('idempotency-key') key: string | undefined,
    @Body() input: CreateAdjustmentDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.adjustments.create(context, key, input);
    response.status(result.replayed ? HttpStatus.OK : HttpStatus.CREATED);
    return result.adjustment;
  }
  @Get()
  @ApiOkResponse()
  list(
    @CurrentAuthentication() context: AuthenticationContext,
    @Query() query: ListAdjustmentsDto,
  ) {
    return this.adjustments.list(context, query);
  }
  @Get(':id')
  @ApiOkResponse()
  get(
    @CurrentAuthentication() context: AuthenticationContext,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ) {
    return this.adjustments.get(context, id);
  }
}
