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
  ApiBody,
  ApiCreatedResponse,
  ApiHeader,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';
import { UserRole } from '../generated/prisma/client.js';
import { CurrentAuthentication, Roles } from '../auth/decorators/access.js';
import type { AuthenticationContext } from '../auth/authenticated-user.js';
import { RegisterShipmentDto } from './dto/register-shipment.dto.js';
import { EmptyShipmentBodyPipe } from './empty-shipment-body.pipe.js';
import { DispatchShipmentDto } from './dto/dispatch-shipment.dto.js';
import { ListShipmentsDto } from './dto/list-shipments.dto.js';
import {
  ShipmentRegistrationResponseDto,
  ShipmentPreparationResponseDto,
  ShipmentDispatchResponseDto,
  ShipmentDetailResponseDto,
  ShipmentListResponseDto,
} from './dto/shipment-response.dto.js';
import { ShipmentRegistrationService } from './shipment-registration.service.js';
import { ShipmentPreparationService } from './shipment-preparation.service.js';
import { ShipmentDispatchService } from './shipment-dispatch.service.js';
import { ShipmentsReadService } from './shipments-read.service.js';
import { shipmentWriterRoles } from './shipment-select.js';

@ApiTags('Shipments')
@ApiBearerAuth()
@Roles(...shipmentWriterRoles, UserRole.MERCHANT)
@Controller('shipments')
export class ShipmentsController {
  constructor(
    @Inject(ShipmentRegistrationService)
    private readonly registration: ShipmentRegistrationService,
    @Inject(ShipmentPreparationService)
    private readonly preparation: ShipmentPreparationService,
    @Inject(ShipmentDispatchService)
    private readonly dispatches: ShipmentDispatchService,
    @Inject(ShipmentsReadService) private readonly reads: ShipmentsReadService,
  ) {}
  @Post()
  @Roles(...shipmentWriterRoles)
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    schema: { type: 'string', format: 'uuid' },
  })
  @ApiCreatedResponse({ type: ShipmentRegistrationResponseDto })
  @ApiOkResponse({
    type: ShipmentRegistrationResponseDto,
    description: 'Identical actor-bound request replay.',
  })
  async register(
    @CurrentAuthentication() context: AuthenticationContext,
    @Headers('idempotency-key') key: string | undefined,
    @Body() input: RegisterShipmentDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.registration.register(context, key, input);
    response.status(result.replayed ? HttpStatus.OK : HttpStatus.CREATED);
    return result.shipment;
  }
  @Post(':id/prepare')
  @ApiBody({
    required: false,
    schema: { type: 'object', additionalProperties: false },
  })
  @Roles(...shipmentWriterRoles)
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    schema: { type: 'string', format: 'uuid' },
  })
  @ApiCreatedResponse({ type: ShipmentPreparationResponseDto })
  @ApiOkResponse({ type: ShipmentPreparationResponseDto })
  async prepare(
    @CurrentAuthentication() context: AuthenticationContext,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Headers('idempotency-key') key: string | undefined,
    @Body(new EmptyShipmentBodyPipe()) _input: unknown,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.preparation.prepare(context, id, key);
    response.status(result.replayed ? HttpStatus.OK : HttpStatus.CREATED);
    return result.preparation;
  }
  @Post(':id/dispatch')
  @Roles(...shipmentWriterRoles)
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    schema: { type: 'string', format: 'uuid' },
  })
  @ApiCreatedResponse({ type: ShipmentDispatchResponseDto })
  @ApiOkResponse({ type: ShipmentDispatchResponseDto })
  async dispatch(
    @CurrentAuthentication() context: AuthenticationContext,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Headers('idempotency-key') key: string | undefined,
    @Body() input: DispatchShipmentDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.dispatches.dispatch(context, id, key, input);
    response.status(result.replayed ? HttpStatus.OK : HttpStatus.CREATED);
    return result.dispatch;
  }
  @Get()
  @ApiOkResponse({ type: ShipmentListResponseDto })
  list(
    @CurrentAuthentication() context: AuthenticationContext,
    @Query() query: ListShipmentsDto,
  ) {
    return this.reads.list(context, query);
  }
  @Get(':id')
  @ApiOkResponse({ type: ShipmentDetailResponseDto })
  get(
    @CurrentAuthentication() context: AuthenticationContext,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ) {
    return this.reads.get(context, id);
  }
}
