import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { PrismaModule } from '../database/prisma.module.js';
import { InventoryController } from './inventory.controller.js';
import { InventoryService } from './inventory.service.js';
import { StockMutationService } from './stock-mutation.service.js';
import { StockPostingService } from './stock-posting.service.js';

@Module({
  imports: [AuthModule, PrismaModule],
  controllers: [InventoryController],
  providers: [InventoryService, StockMutationService, StockPostingService],
  exports: [StockMutationService, StockPostingService],
})
export class InventoryModule {}
