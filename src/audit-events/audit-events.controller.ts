import {
  Controller,
  Get,
  Inject,
  Param,
  ParseUUIDPipe,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiExtraModels,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';
import { UserRole } from '../generated/prisma/client.js';
import { CurrentAuthentication, Roles } from '../auth/decorators/access.js';
import type { AuthenticationContext } from '../auth/authenticated-user.js';
import { AuditEventsReadService } from './audit-events-read.service.js';
import { AuditEventsQueryDto } from './dto/audit-events-query.dto.js';
import {
  AuditEventResponseDto,
  AuditEventsPageDto,
  ItemAuditSnapshotDto,
  RowAuditSnapshotDto,
  ShelfAuditSnapshotDto,
  UserAuditSnapshotDto,
  MerchantAuditSnapshotDto,
} from './dto/audit-event-response.dto.js';
@ApiTags('Audit events')
@ApiBearerAuth()
@Roles(UserRole.ADMIN)
@ApiExtraModels(
  ItemAuditSnapshotDto,
  RowAuditSnapshotDto,
  ShelfAuditSnapshotDto,
  UserAuditSnapshotDto,
  MerchantAuditSnapshotDto,
)
@Controller('audit-events')
export class AuditEventsController {
  constructor(
    @Inject(AuditEventsReadService)
    private readonly events: AuditEventsReadService,
  ) {}
  @Get()
  @ApiOkResponse({ type: AuditEventsPageDto })
  list(
    @CurrentAuthentication() context: AuthenticationContext,
    @Query() query: AuditEventsQueryDto,
  ) {
    return this.events.list(context, query);
  }
  @Get(':id')
  @ApiOkResponse({ type: AuditEventResponseDto })
  get(
    @CurrentAuthentication() context: AuthenticationContext,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ) {
    return this.events.get(context, id);
  }
}
