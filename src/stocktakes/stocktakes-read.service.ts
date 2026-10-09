import {
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import type { Prisma } from '../generated/prisma/client.js';
import type { AuthenticationContext } from '../auth/authenticated-user.js';
import type {
  ListStocktakesDto,
  StocktakeLinesQueryDto,
} from './dto/stocktake.dto.js';
@Injectable()
export class StocktakesReadService {
  constructor(
    @Inject(PrismaService) private readonly database: PrismaService,
  ) {}
  private scope(
    context: AuthenticationContext,
    requested?: string,
  ): string | undefined {
    if (context.user.role === 'MERCHANT') {
      if (
        !context.user.merchantId ||
        (requested && requested !== context.user.merchantId)
      )
        throw new ForbiddenException('Access denied');
      return context.user.merchantId;
    }
    return requested;
  }
  async list(context: AuthenticationContext, q: ListStocktakesDto) {
    const merchantId = this.scope(context, q.merchantId);
    const ids = merchantId
      ? (
          await this.database.stocktakeScope.findMany({
            where: { merchantId },
            select: { stocktakeId: true },
            distinct: ['stocktakeId'],
          })
        ).map((s) => s.stocktakeId)
      : undefined;
    const where: Prisma.StocktakeWhereInput = {
      ...(ids ? { id: { in: ids } } : {}),
      ...(q.status ? { status: q.status } : {}),
    };
    const [items, total] = await this.database.$transaction(
      [
        this.database.stocktake.findMany({
          where,
          orderBy: [{ openedAt: 'desc' }, { id: 'desc' }],
          skip: (q.page - 1) * q.limit,
          take: q.limit,
        }),
        this.database.stocktake.count({ where }),
      ],
      { isolationLevel: 'RepeatableRead' },
    );
    return {
      items:
        context.user.role === 'MERCHANT'
          ? items.map((s) => ({
              id: s.id,
              kind: s.kind,
              status: s.status,
              openedAt: s.openedAt,
              closedAt: s.closedAt,
            }))
          : items,
      total,
      page: q.page,
      limit: q.limit,
    };
  }
  async get(context: AuthenticationContext, id: string) {
    const merchantId = this.scope(context);
    const cycle = await this.database.stocktake.findUnique({ where: { id } });
    if (
      !cycle ||
      (merchantId &&
        !(await this.database.stocktakeScope.findFirst({
          where: { stocktakeId: id, merchantId },
        })))
    )
      throw new NotFoundException('Stocktake not found');
    return context.user.role === 'MERCHANT'
      ? {
          id: cycle.id,
          kind: cycle.kind,
          status: cycle.status,
          openedAt: cycle.openedAt,
          closedAt: cycle.closedAt,
        }
      : cycle;
  }
  async lines(
    context: AuthenticationContext,
    id: string,
    q: StocktakeLinesQueryDto,
  ) {
    await this.get(context, id);
    const merchantId = this.scope(context, q.merchantId);
    const where = {
      stocktakeId: id,
      ...(merchantId ? { merchantId } : {}),
      ...(q.shelfId ? { shelfId: q.shelfId } : {}),
    };
    return this.database.$transaction(
      async (tx) => {
        const items = await tx.stocktakeLine.findMany({
          where,
          orderBy: { id: 'asc' },
          skip: (q.page - 1) * q.limit,
          take: q.limit,
        });
        const total = await tx.stocktakeLine.count({ where });
        const counts = await tx.stocktakeCountEntry.findMany({
          where: { lineId: { in: items.map((l) => l.id) } },
        });
        return {
          items: items.map((l) => {
            const c = counts.find(
              (c) => c.lineId === l.id && c.version === l.version,
            );
            return {
              ...l,
              quantity: c?.quantity ?? null,
              difference: c ? c.quantity - l.expectedQuantity : null,
              reason: c?.reason ?? null,
              notes: c?.notes ?? null,
              ...(context.user.role === 'MERCHANT'
                ? {}
                : {
                    countedById: c?.actorId ?? null,
                    countedByNameSnapshot: c?.actorNameSnapshot ?? null,
                    countedAt: c?.recordedAt ?? null,
                  }),
            };
          }),
          total,
          page: q.page,
          limit: q.limit,
        };
      },
      { isolationLevel: 'RepeatableRead' },
    );
  }
  async events(
    context: AuthenticationContext,
    id: string,
    q: ListStocktakesDto,
  ) {
    if (context.user.role === 'MERCHANT')
      throw new ForbiddenException(
        'Staff audit history is not available to merchants',
      );
    await this.get(context, id);
    const [items, total] = await this.database.$transaction(
      [
        this.database.stocktakeEvent.findMany({
          where: { stocktakeId: id },
          orderBy: { sequence: 'asc' },
          skip: (q.page - 1) * q.limit,
          take: q.limit,
        }),
        this.database.stocktakeEvent.count({ where: { stocktakeId: id } }),
      ],
      { isolationLevel: 'RepeatableRead' },
    );
    return { items, total, page: q.page, limit: q.limit };
  }
  async scopes(
    context: AuthenticationContext,
    id: string,
    q: ListStocktakesDto,
  ) {
    await this.get(context, id);
    const merchantId = this.scope(context, q.merchantId),
      where = { stocktakeId: id, ...(merchantId ? { merchantId } : {}) };
    const [items, total] = await this.database.$transaction(
      [
        this.database.stocktakeScope.findMany({
          where,
          orderBy: { shelfCodeSnapshot: 'asc' },
          skip: (q.page - 1) * q.limit,
          take: q.limit,
        }),
        this.database.stocktakeScope.count({ where }),
      ],
      { isolationLevel: 'RepeatableRead' },
    );
    return { items, total, page: q.page, limit: q.limit };
  }
}
