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
import type {
  RecordStocktakeCountDto,
  StocktakeAttendanceDto,
  StocktakeNotesDto,
} from './dto/stocktake.dto.js';
@Injectable()
export class StocktakeCountingService {
  constructor(
    @Inject(PrismaService) private readonly database: PrismaService,
    @Inject(StocktakeTransactionService)
    private readonly transactions: StocktakeTransactionService,
  ) {}
  count(
    context: AuthenticationContext,
    id: string,
    key: string | undefined,
    input: RecordStocktakeCountDto,
  ) {
    const cycleId = id.toLowerCase();
    if (
      input.lineId
        ? input.itemId || input.shelfId
        : !(input.itemId && input.shelfId)
    )
      throw new BadRequestException(
        'Specify lineId or an item and shelf, exclusively',
      );
    return this.transactions.run(
      context,
      key,
      'COUNTED',
      {
        cycleId,
        lineId: input.lineId ?? null,
        itemId: input.itemId ?? null,
        shelfId: input.shelfId ?? null,
        expectedVersion: input.expectedVersion,
        quantity: input.quantity,
        reason: input.reason ?? null,
        notes: input.notes ?? null,
      },
      false,
      ['ADMIN', 'WAREHOUSE_KEEPER'],
      async (tx, current) => {
        const cycle = await this.transactions.lockCycle(tx, cycleId, [
          'COUNTING',
        ]);
        await this.transactions.requireCounter(tx, cycle, current);
        let line = input.lineId
          ? await tx.stocktakeLine.findFirst({
              where: { id: input.lineId, stocktakeId: cycleId },
            })
          : await tx.stocktakeLine.findFirst({
              where: {
                stocktakeId: cycleId,
                itemId: input.itemId,
                shelfId: input.shelfId,
                category: 'AVAILABLE',
              },
            });
        if (!line && !input.lineId) {
          const scope = await tx.stocktakeScope.findUnique({
            where: {
              stocktakeId_shelfId: {
                stocktakeId: cycleId,
                shelfId: input.shelfId!,
              },
            },
          });
          const item = await tx.item.findUnique({
            where: { id: input.itemId! },
          });
          if (!scope || !item || item.merchantId !== scope.merchantId)
            throw new BadRequestException(
              'Item or shelf is outside stocktake scope',
            );
          const balance = await tx.stockPlacementBalance.findFirst({
            where: {
              warehouseId: cycle.warehouseId,
              itemId: item.id,
              shelfId: scope.shelfId,
            },
          });
          line = await tx.stocktakeLine.create({
            data: {
              stocktakeId: cycleId,
              warehouseId: cycle.warehouseId,
              merchantId: scope.merchantId,
              shelfId: scope.shelfId,
              itemId: item.id,
              category: 'AVAILABLE',
              itemCodeSnapshot: item.code,
              itemNameSnapshot: item.name,
              expectedQuantity: balance?.quantity ?? 0,
            },
          });
        }
        if (!line) throw new NotFoundException('Count line not found');
        if (line.version !== input.expectedVersion)
          throw new ConflictException(
            'Count version changed; refresh before recounting',
          );
        if (input.quantity !== line.expectedQuantity && !input.reason?.trim())
          throw new BadRequestException('Every difference requires a reason');
        const version = line.version + 1,
          recordedAt = await this.database.time(tx);
        await tx.stocktakeLine.update({
          where: { id: line.id },
          data: { version },
        });
        await tx.stocktakeCountEntry.create({
          data: {
            lineId: line.id,
            version,
            quantity: input.quantity,
            reason: input.reason?.trim() ?? null,
            notes: input.notes?.trim() ?? null,
            actorId: current.user.id,
            actorNameSnapshot: current.user.displayName,
            recordedAt,
          },
        });
        return {
          stocktakeId: cycleId,
          details: {
            lineId: line.id,
            version,
            quantity: input.quantity,
            difference: input.quantity - line.expectedQuantity,
            category: line.category,
            reason: input.reason ?? null,
            notes: input.notes ?? null,
          },
        };
      },
    );
  }
  attendance(
    context: AuthenticationContext,
    id: string,
    key: string | undefined,
    input: StocktakeAttendanceDto,
  ) {
    return this.transactions.run(
      context,
      key,
      'ATTENDANCE',
      { id, userId: input.userId, present: input.present, notes: input.notes },
      false,
      ['ADMIN', 'WAREHOUSE_KEEPER'],
      async (tx, current) => {
        const cycle = await this.transactions.lockCycle(tx, id, [
          'COUNTING',
          'PENDING_APPROVAL',
        ]);
        await this.transactions.requireCounter(tx, cycle, current);
        const user = await tx.user.findUnique({ where: { id: input.userId } });
        if (!user || !user.isActive || user.role === 'MERCHANT')
          throw new BadRequestException(
            'Only active staff can be recorded as present',
          );
        return {
          stocktakeId: id,
          details: {
            userId: user.id,
            userNameSnapshot: user.displayName,
            role: user.role,
            present: input.present,
            notes: input.notes,
          },
        };
      },
    );
  }
  transition(
    context: AuthenticationContext,
    id: string,
    key: string | undefined,
    input: StocktakeNotesDto,
    kind: 'SUBMITTED' | 'REOPENED' | 'NOTED',
  ) {
    return this.transactions.run(
      context,
      key,
      kind,
      { id, notes: input.notes },
      true,
      kind === 'REOPENED' ? ['ADMIN'] : ['ADMIN', 'WAREHOUSE_KEEPER'],
      async (tx, current) => {
        const cycle = await this.transactions.lockCycle(
          tx,
          id,
          kind === 'SUBMITTED'
            ? ['COUNTING']
            : kind === 'REOPENED'
              ? ['PENDING_APPROVAL']
              : ['COUNTING', 'PENDING_APPROVAL'],
        );
        if (kind !== 'REOPENED')
          await this.transactions.requireCounter(tx, cycle, current);
        if (kind === 'SUBMITTED') {
          if (
            await tx.stocktakeLine.count({
              where: { stocktakeId: id, version: 0 },
            })
          )
            throw new ConflictException(
              'Every stocktake line must be explicitly counted',
            );
          await tx.stocktake.update({
            where: { id },
            data: { status: 'PENDING_APPROVAL' },
          });
        } else if (kind === 'REOPENED')
          await tx.stocktake.update({
            where: { id },
            data: { status: 'COUNTING' },
          });
        return { stocktakeId: id, details: { notes: input.notes } };
      },
    );
  }
}
