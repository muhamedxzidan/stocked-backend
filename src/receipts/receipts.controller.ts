import {
  ReceiptResponseDto,
  ReceiptListResponseDto,
} from './dto/receipt-response.dto.js';
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
  ApiHeader,
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
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    schema: { type: 'string', format: 'uuid' },
  })
  @ApiCreatedResponse({ type: ReceiptResponseDto })
  @ApiOkResponse({
    type: ReceiptResponseDto,
    description: 'Identical actor-bound replay',
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
  @ApiOkResponse({ type: ReceiptListResponseDto })
  list(
    @CurrentAuthentication() context: AuthenticationContext,
    @Query() query: ListReceiptsDto,
  ) {
    return this.receipts.list(context, query);
  }

  @Get(':id')
  @ApiOkResponse({ type: ReceiptResponseDto })
  get(
    @CurrentAuthentication() context: AuthenticationContext,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ) {
    return this.receipts.get(context, id);
  }
}
