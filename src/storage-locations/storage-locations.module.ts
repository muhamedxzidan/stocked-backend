import { AuditEventsModule } from '../audit-events/audit-events.module.js';
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { PrismaModule } from '../database/prisma.module.js';
import { InventoryModule } from '../inventory/inventory.module.js';
import { StorageLocationsService } from './storage-locations.service.js';
import { StorageLocationsController } from './storage-locations.controller.js';
@Module({
  imports: [AuditEventsModule, AuthModule, PrismaModule, InventoryModule],
  providers: [StorageLocationsService],
  controllers: [StorageLocationsController],
})
export class StorageLocationsModule {}
