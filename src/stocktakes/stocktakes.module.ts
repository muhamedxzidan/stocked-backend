import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { InventoryModule } from '../inventory/inventory.module.js';
import { PrismaModule } from '../database/prisma.module.js';
import { OperationControlModule } from '../operation-control/operation-control.module.js';
import { StocktakeTransactionService } from './stocktake-transaction.service.js';
import { StocktakeOpeningService } from './stocktake-opening.service.js';
import { StocktakeCountingService } from './stocktake-counting.service.js';
import { StocktakeApprovalService } from './stocktake-approval.service.js';
import { StocktakeCancellationService } from './stocktake-cancellation.service.js';
import { StocktakesReadService } from './stocktakes-read.service.js';
import { StocktakesController } from './stocktakes.controller.js';
@Module({
  imports: [AuthModule, InventoryModule, PrismaModule, OperationControlModule],
  controllers: [StocktakesController],
  providers: [
    StocktakeTransactionService,
    StocktakeOpeningService,
    StocktakeCountingService,
    StocktakeApprovalService,
    StocktakeCancellationService,
    StocktakesReadService,
  ],
})
export class StocktakesModule {}
