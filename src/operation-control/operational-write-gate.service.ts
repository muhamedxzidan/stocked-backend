import { ConflictException, Injectable } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client.js';

/** Coordinates short transactions; active stocktakes are persisted, never held in memory. */
@Injectable()
export class OperationalWriteGateService {
  async shared(transaction: Prisma.TransactionClient): Promise<void> {
    await transaction.$executeRaw`SELECT pg_advisory_xact_lock_shared(847314, 1)`;
  }
  async exclusive(transaction: Prisma.TransactionClient): Promise<void> {
    await transaction.$executeRaw`SELECT pg_advisory_xact_lock(847314, 1)`;
  }
  async enter(transaction: Prisma.TransactionClient): Promise<void> {
    await this.shared(transaction);
    const active = await transaction.stocktake.findFirst({
      where: { status: { in: ['COUNTING', 'PENDING_APPROVAL'] } },
      select: { id: true },
    });
    if (active)
      throw new ConflictException({
        statusCode: 409,
        code: 'STOCKTAKE_ACTIVE',
        message: 'All business modifications are paused during stocktake',
        stocktakeId: active.id,
      });
  }
}
