import {
  Body,
  Controller,
  Get,
  Headers,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiHeader,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { UserRole } from '../generated/prisma/client.js';
import { CurrentAuthentication, Roles } from '../auth/decorators/access.js';
import type { AuthenticationContext } from '../auth/authenticated-user.js';
import { ReceiveReturnDto } from './dto/receive-return.dto.js';
import { InspectReturnDto } from './dto/inspect-return.dto.js';
import { ReviewReturnDto } from './dto/review-return.dto.js';
import { ListReturnsDto } from './dto/list-returns.dto.js';
import { ReturnReceivingService } from './return-receiving.service.js';
import { ReturnInspectionService } from './return-inspection.service.js';
import { ReturnReviewService } from './return-review.service.js';
import { ReturnsReadService } from './returns-read.service.js';
import { returnReviewerRoles, returnWriterRoles } from './return-select.js';
import {
  ReturnReceiptResponseDto,
  ReturnInspectionResponseDto,
  ReturnReviewResponseDto,
  ReturnDetailResponseDto,
  ReturnListResponseDto,
} from './dto/return-response.dto.js';
@ApiTags('Returns')
@ApiBearerAuth()
@Roles(...returnWriterRoles, UserRole.MERCHANT)
@Controller('returns')
export class ReturnsController {
  constructor(
    @Inject(ReturnReceivingService)
    private readonly receiving: ReturnReceivingService,
    @Inject(ReturnInspectionService)
    private readonly inspections: ReturnInspectionService,
    @Inject(ReturnReviewService) private readonly reviews: ReturnReviewService,
    @Inject(ReturnsReadService) private readonly reads: ReturnsReadService,
  ) {}
  @Post()
  @Roles(...returnWriterRoles)
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    schema: { type: 'string', format: 'uuid' },
  })
  @ApiCreatedResponse({ type: ReturnReceiptResponseDto })
  @ApiOkResponse({
    type: ReturnReceiptResponseDto,
    description: 'Identical actor-bound replay',
  })
  async receive(
    @CurrentAuthentication() context: AuthenticationContext,
    @Headers('idempotency-key') key: string | undefined,
    @Body() input: ReceiveReturnDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.receiving.receive(context, key, input);
    response.status(result.replayed ? 200 : 201);
    return result.receipt;
  }
  @Post(':id/inspect')
  @Roles(...returnWriterRoles)
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    schema: { type: 'string', format: 'uuid' },
  })
  @ApiCreatedResponse({ type: ReturnInspectionResponseDto })
  @ApiOkResponse({
    type: ReturnInspectionResponseDto,
    description: 'Identical actor-bound replay',
  })
  async inspect(
    @CurrentAuthentication() context: AuthenticationContext,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Headers('idempotency-key') key: string | undefined,
    @Body() input: InspectReturnDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.inspections.inspect(context, id, key, input);
    response.status(result.replayed ? 200 : 201);
    return result.inspection;
  }
  @Post('inspection-lines/:id/review')
  @Roles(...returnReviewerRoles)
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    schema: { type: 'string', format: 'uuid' },
  })
  @ApiCreatedResponse({ type: ReturnReviewResponseDto })
  @ApiOkResponse({
    type: ReturnReviewResponseDto,
    description: 'Identical actor-bound replay',
  })
  async review(
    @CurrentAuthentication() context: AuthenticationContext,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Headers('idempotency-key') key: string | undefined,
    @Body() input: ReviewReturnDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.reviews.review(context, id, key, input);
    response.status(result.replayed ? 200 : 201);
    return result.review;
  }
  @Get()
  @ApiOkResponse({ type: ReturnListResponseDto })
  list(
    @CurrentAuthentication() context: AuthenticationContext,
    @Query() query: ListReturnsDto,
  ) {
    return this.reads.list(context, query);
  }
  @Get(':id')
  @ApiOkResponse({ type: ReturnDetailResponseDto })
  get(
    @CurrentAuthentication() context: AuthenticationContext,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ) {
    return this.reads.get(context, id);
  }
}
