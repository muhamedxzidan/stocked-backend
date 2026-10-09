import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { InventoryModule } from '../inventory/inventory.module.js';
import { PrismaModule } from '../database/prisma.module.js';
import { ShipmentsController } from './shipments.controller.js';
import { ShipmentCodeService } from './shipment-code.service.js';
import { ShipmentRegistrationService } from './shipment-registration.service.js';
import { ShipmentPreparationService } from './shipment-preparation.service.js';
import { ShipmentDispatchService } from './shipment-dispatch.service.js';
import { ShipmentsReadService } from './shipments-read.service.js';

@Module({
  imports: [AuthModule, InventoryModule, PrismaModule],
  controllers: [ShipmentsController],
  providers: [
    ShipmentCodeService,
    ShipmentRegistrationService,
    ShipmentPreparationService,
    ShipmentDispatchService,
    ShipmentsReadService,
  ],
})
export class ShipmentsModule {}
