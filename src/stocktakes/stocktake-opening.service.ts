import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { AuthenticationContext } from '../auth/authenticated-user.js';
import { PrismaService } from '../database/prisma.service.js';
import { StocktakeTransactionService } from './stocktake-transaction.service.js';
import type { OpenStocktakeDto } from './dto/stocktake.dto.js';
@Injectable()
export class StocktakeOpeningService {
  constructor(
    @Inject(PrismaService) private readonly database: PrismaService,
    @Inject(StocktakeTransactionService)
    private readonly transactions: StocktakeTransactionService,
  ) {}
  open(
    context: AuthenticationContext,
    key: string | undefined,
    input: OpenStocktakeDto,
  ) {
    const canonical = {
      kind: input.kind,
      targetId: input.targetId?.toLowerCase() ?? null,
      directorId: input.directorId.toLowerCase(),
      participantIds: [
        ...new Set(input.participantIds.map((id) => id.toLowerCase())),
      ].sort(),
      notes: input.notes,
    };
    if ((canonical.kind === 'FULL') !== (canonical.targetId === null))
      throw new BadRequestException(
        'FULL has no target; other kinds require a target',
      );
    return this.transactions.run(
      context,
      key,
      'OPENED',
      canonical,
      true,
      ['ADMIN', 'WAREHOUSE_KEEPER'],
      async (tx, current, recordedAt) => {
        if (
          await tx.stocktake.findFirst({
            where: { status: { in: ['COUNTING', 'PENDING_APPROVAL'] } },
          })
        )
          throw new ConflictException('A stocktake is already active');
        if (
          (await tx.stockPlacementBalance.count({
            where: { shelfId: null, quantity: { gt: 0 } },
          })) ||
          (await tx.returnCustodyBalance.count({
            where: { shelfId: null, quantity: { gt: 0 } },
          }))
        )
          throw new ConflictException(
            'Allocate all unassigned stock and custody before opening stocktake',
          );
        const warehouse = await tx.warehouse.findUnique({
          where: { code: 'MAIN' },
        });
        if (!warehouse) throw new NotFoundException('Warehouse not found');
        const attendees = await tx.user.findMany({
          where: {
            id: { in: canonical.participantIds },
            isActive: true,
            role: { in: ['ADMIN', 'WAREHOUSE_KEEPER', 'EMPLOYEE'] },
          },
        });
        const director = attendees.find(
          (u) => u.id === canonical.directorId && u.role === 'ADMIN',
        );
        if (
          attendees.length !== canonical.participantIds.length ||
          !director ||
          !canonical.participantIds.includes(current.user.id)
        )
          throw new BadRequestException(
            'Record active staff including opener and director as present',
          );
        const shelves = await tx.storageShelf.findMany({
          where: {
            warehouseId: warehouse.id,
            ...(canonical.kind === 'MERCHANT'
              ? { merchantId: canonical.targetId! }
              : {}),
            ...(canonical.kind === 'ROW' ? { rowId: canonical.targetId! } : {}),
            ...(canonical.kind === 'SHELF' ? { id: canonical.targetId! } : {}),
          },
          orderBy: { id: 'asc' },
        });
        if (!shelves.length)
          throw new NotFoundException(
            'No shelves found within requested scope',
          );
        const cycle = await tx.stocktake.create({
          data: {
            warehouseId: warehouse.id,
            kind: canonical.kind,
            targetId: canonical.targetId,
            openedById: current.user.id,
            openedByNameSnapshot: current.user.displayName,
            openedAt: recordedAt,
            directorId: director.id,
            directorNameSnapshot: director.displayName,
            notes: canonical.notes,
          },
        });
        const rows = await tx.storageRow.findMany({
          where: { id: { in: shelves.map((s) => s.rowId) } },
        });
        const merchants = await tx.merchant.findMany({
          where: { id: { in: shelves.map((s) => s.merchantId) } },
        });
        await tx.stocktakeScope.createMany({
          data: shelves.map((s) => ({
            stocktakeId: cycle.id,
            shelfId: s.id,
            rowId: s.rowId,
            merchantId: s.merchantId,
            shelfCodeSnapshot: s.code,
            rowCodeSnapshot: rows.find((r) => r.id === s.rowId)!.code,
            merchantNameSnapshot: merchants.find((m) => m.id === s.merchantId)!
              .name,
          })),
        });
        const shelfIds = shelves.map((s) => s.id);
        const balances = await tx.stockPlacementBalance.findMany({
          where: { shelfId: { in: shelfIds } },
        });
        const custody = await tx.returnCustodyBalance.findMany({
          where: { shelfId: { in: shelfIds }, quantity: { gt: 0 } },
        });
        const items = await tx.item.findMany({
          where: {
            id: {
              in: [...new Set([...balances, ...custody].map((b) => b.itemId))],
            },
          },
        });
        const data = [
          ...balances.map((b) => ({
            ...b,
            category: 'AVAILABLE',
            receiptLineId: null,
          })),
          ...custody.map((b) => ({ ...b, category: 'CUSTODY' })),
        ].map((b) => ({
          stocktakeId: cycle.id,
          warehouseId: warehouse.id,
          merchantId: b.merchantId,
          shelfId: b.shelfId!,
          itemId: b.itemId,
          receiptLineId: b.receiptLineId,
          category: b.category,
          itemCodeSnapshot: items.find((i) => i.id === b.itemId)!.code,
          itemNameSnapshot: items.find((i) => i.id === b.itemId)!.name,
          expectedQuantity: b.quantity,
        }));
        if (data.length) await tx.stocktakeLine.createMany({ data });
        return {
          stocktakeId: cycle.id,
          details: {
            participantIds: canonical.participantIds,
            participants: attendees.map((u) => ({
              id: u.id,
              name: u.displayName,
              role: u.role,
            })),
            directorId: director.id,
            scopeCount: shelves.length,
            lineCount: data.length,
            notes: canonical.notes,
          },
        };
      },
    );
  }
}
