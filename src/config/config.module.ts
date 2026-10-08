import { Global, Module } from '@nestjs/common';
import { Environment } from './environment.js';
@Global()
@Module({ providers: [Environment], exports: [Environment] })
export class ConfigModule {}
