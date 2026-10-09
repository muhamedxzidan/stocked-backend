import { AuditEventsModule } from './audit-events/audit-events.module.js';
import { StocktakesModule } from './stocktakes/stocktakes.module.js';
import { StorageLocationsModule } from './storage-locations/storage-locations.module.js';
import { ItemsModule } from './items/items.module.js';
import { ShipmentsModule } from './shipments/shipments.module.js';
import { ReturnsModule } from './returns/returns.module.js';
import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module.js';
import { UsersModule } from './users/users.module.js';
import { MerchantsModule } from './merchants/merchants.module.js';
import { InventoryModule } from './inventory/inventory.module.js';
import { ReceiptsModule } from './receipts/receipts.module.js';
import { StockAdjustmentsModule } from './stock-adjustments/stock-adjustments.module.js';
import { HealthController } from './health/health.controller.js';
@Module({
  imports: [
    AuditEventsModule,
    StocktakesModule,
    StorageLocationsModule,
    AuthModule,
    UsersModule,
    MerchantsModule,
    ItemsModule,
    InventoryModule,
    ReceiptsModule,
    StockAdjustmentsModule,
    ShipmentsModule,
    ReturnsModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
