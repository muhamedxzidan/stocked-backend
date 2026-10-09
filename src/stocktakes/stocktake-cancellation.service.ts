import { Inject, Injectable } from '@nestjs/common';
import type { AuthenticationContext } from '../auth/authenticated-user.js';
import { PrismaService } from '../database/prisma.service.js';
import { StocktakeTransactionService } from './stocktake-transaction.service.js';
import type { StocktakeNotesDto } from './dto/stocktake.dto.js';
@Injectable()
export class StocktakeCancellationService {
  constructor(
    @Inject(PrismaService) private readonly database: PrismaService,
    @Inject(StocktakeTransactionService)
    private readonly transactions: StocktakeTransactionService,
  ) {}
  cancel(
    context: AuthenticationContext,
    id: string,
    key: string | undefined,
    input: StocktakeNotesDto,
  ) {
    return this.transactions.run(
      context,
      key,
      'CANCELLED',
      { id, notes: input.notes },
      true,
      ['ADMIN'],
      async (tx, current) => {
        await this.transactions.lockCycle(tx, id, [
          'COUNTING',
          'PENDING_APPROVAL',
        ]);
        const closedAt = await this.database.time(tx);
        await tx.stocktake.update({
          where: { id },
          data: {
            status: 'CANCELLED',
            closedById: current.user.id,
            closedByNameSnapshot: current.user.displayName,
            closedAt,
            closingNotes: input.notes,
          },
        });
        return {
          stocktakeId: id,
          details: { notes: input.notes, stockChanged: false },
        };
      },
    );
  }
}
