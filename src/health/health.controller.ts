import {
  Controller,
  Get,
  Inject,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { Public } from '../auth/decorators/access.js';
@Controller('health')
export class HealthController {
  constructor(
    @Inject(PrismaService) private readonly database: PrismaService,
  ) {}
  @Public()
  @Get()
  async health(): Promise<{ status: string }> {
    try {
      await this.database.$queryRaw`SELECT 1`;
      return { status: 'ok' };
    } catch {
      throw new ServiceUnavailableException('Database unavailable');
    }
  }
}
