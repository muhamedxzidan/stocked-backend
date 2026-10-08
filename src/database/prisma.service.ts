import {
  Inject,
  Injectable,
  type OnModuleInit,
  type OnModuleDestroy,
} from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, type Prisma } from '../generated/prisma/client.js';
import { Environment } from '../config/environment.js';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  constructor(@Inject(Environment) environment: Environment) {
    super({
      adapter: new PrismaPg({ connectionString: environment.databaseUrl }),
      errorFormat: 'minimal',
    });
  }
  async onModuleInit(): Promise<void> {
    await this.$connect();
  }
  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
  async time(transaction: Prisma.TransactionClient): Promise<Date> {
    const [row] = await transaction.$queryRaw<
      { now: Date }[]
    >`SELECT date_trunc('milliseconds', clock_timestamp()) AS now`;
    return row.now;
  }
}
