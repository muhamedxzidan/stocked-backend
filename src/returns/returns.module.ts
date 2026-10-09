import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { PrismaModule } from '../database/prisma.module.js';
import { InventoryModule } from '../inventory/inventory.module.js';
import { ReturnsController } from './returns.controller.js';
import { ReturnReceivingService } from './return-receiving.service.js';
import { ReturnInspectionService } from './return-inspection.service.js';
import { ReturnReviewService } from './return-review.service.js';
import { ReturnsReadService } from './returns-read.service.js';
@Module({
  imports: [AuthModule, PrismaModule, InventoryModule],
  controllers: [ReturnsController],
  providers: [
    ReturnReceivingService,
    ReturnInspectionService,
    ReturnReviewService,
    ReturnsReadService,
  ],
})
export class ReturnsModule {}
