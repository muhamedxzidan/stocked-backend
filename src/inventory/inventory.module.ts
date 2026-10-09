import { StockPlacementService } from './stock-placement.service.js';
import { ReturnCustodyPlacementService } from './return-custody-placement.service.js';
import { OperationControlModule } from '../operation-control/operation-control.module.js';
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { PrismaModule } from '../database/prisma.module.js';
import { InventoryController } from './inventory.controller.js';
import { InventoryService } from './inventory.service.js';
import { StockMutationService } from './stock-mutation.service.js';
import { StockPostingService } from './stock-posting.service.js';

@Module({
  imports: [OperationControlModule, AuthModule, PrismaModule],
  controllers: [InventoryController],
  providers: [
    StockPlacementService,
    ReturnCustodyPlacementService,
    InventoryService,
    StockMutationService,
    StockPostingService,
  ],
  exports: [
    StockPlacementService,
    ReturnCustodyPlacementService,
    StockMutationService,
    StockPostingService,
  ],
})
export class InventoryModule {}
