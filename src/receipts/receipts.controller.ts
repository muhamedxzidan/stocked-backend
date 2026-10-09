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
import { CreateReceiptDto } from './dto/create-receipt.dto.js';
import { ListReceiptsDto } from './dto/list-receipts.dto.js';
import { ReceiptsService } from './receipts.service.js';

@ApiTags('Receipts')
@ApiBearerAuth()
@Roles(
  UserRole.ADMIN,
  UserRole.WAREHOUSE_KEEPER,
  UserRole.EMPLOYEE,
  UserRole.MERCHANT,
)
@Controller('receipts')
export class ReceiptsController {
  constructor(
    @Inject(ReceiptsService) private readonly receipts: ReceiptsService,
  ) {}

  @Post()
  @Roles(UserRole.ADMIN, UserRole.WAREHOUSE_KEEPER, UserRole.EMPLOYEE)
  @ApiCreatedResponse({
    description:
      'Receipt created, or HTTP 200 when an identical idempotent request is replayed.',
  })
  async create(
    @CurrentAuthentication() context: AuthenticationContext,
    @Headers('idempotency-key') key: string | undefined,
    @Body() input: CreateReceiptDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.receipts.create(context, key, input);
    response.status(result.replayed ? HttpStatus.OK : HttpStatus.CREATED);
    return result.receipt;
  }

  @Get()
  @ApiOkResponse()
  list(
    @CurrentAuthentication() context: AuthenticationContext,
    @Query() query: ListReceiptsDto,
  ) {
    return this.receipts.list(context, query);
  }

  @Get(':id')
  get(
    @CurrentAuthentication() context: AuthenticationContext,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ) {
    return this.receipts.get(context, id);
  }
}
