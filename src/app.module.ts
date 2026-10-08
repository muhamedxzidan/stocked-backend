import { ItemsModule } from './items/items.module.js';
import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module.js';
import { UsersModule } from './users/users.module.js';
import { MerchantsModule } from './merchants/merchants.module.js';
import { HealthController } from './health/health.controller.js';
@Module({
  imports: [AuthModule, UsersModule, MerchantsModule, ItemsModule],
  controllers: [HealthController],
})
export class AppModule {}
