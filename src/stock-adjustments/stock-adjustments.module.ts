import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { InventoryModule } from '../inventory/inventory.module.js';
import { PrismaModule } from '../database/prisma.module.js';
import { StockAdjustmentsController } from './stock-adjustments.controller.js';
import { StockAdjustmentsService } from './stock-adjustments.service.js';
@Module({
  imports: [AuthModule, InventoryModule, PrismaModule],
  controllers: [StockAdjustmentsController],
  providers: [StockAdjustmentsService],
})
export class StockAdjustmentsModule {}
