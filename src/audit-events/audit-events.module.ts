import { Module } from '@nestjs/common';
import { PrismaModule } from '../database/prisma.module.js';
import { AuditEventWriter } from './audit-event-writer.js';
import { AuditEventsReadService } from './audit-events-read.service.js';
import { AuditEventsController } from './audit-events.controller.js';
@Module({
  imports: [PrismaModule],
  providers: [AuditEventWriter, AuditEventsReadService],
  controllers: [AuditEventsController],
  exports: [AuditEventWriter],
})
export class AuditEventsModule {}
