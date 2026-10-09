import { AuditEventsModule } from '../audit-events/audit-events.module.js';
import { OperationControlModule } from '../operation-control/operation-control.module.js';
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { PrismaModule } from '../database/prisma.module.js';
import { ItemsController } from './items.controller.js';
import { ItemsService } from './items.service.js';
import { ItemCodeService } from './item-code.service.js';
@Module({
  imports: [
    AuditEventsModule,
    OperationControlModule,
    AuthModule,
    PrismaModule,
  ],
  controllers: [ItemsController],
  providers: [ItemsService, ItemCodeService],
})
export class ItemsModule {}
