import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { AdminMutationService } from '../auth/admin-mutation.service.js';
import type { AuthenticationContext } from '../auth/authenticated-user.js';
import { Prisma } from '../generated/prisma/client.js';
import type {
  CreateStorageRowDto,
  CreateStorageShelfDto,
  ListStorageLocationsDto,
  UpdateStorageLocationDto,
} from './dto/storage-location.dto.js';
@Injectable()
export class StorageLocationsService {
  constructor(
    @Inject(PrismaService) private readonly database: PrismaService,
    @Inject(AdminMutationService)
    private readonly mutations: AdminMutationService,
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
  async createRow(context: AuthenticationContext, input: CreateStorageRowDto) {
    return this.mutations.run(context, [], async (tx) => {
      const warehouse = await tx.warehouse.findUnique({
        where: { code: 'MAIN' },
      });
      if (!warehouse) throw new NotFoundException('Warehouse not found');
      return tx.storageRow.create({
        data: {
          warehouseId: warehouse.id,
          code: input.code,
          name: input.name,
          createdById: context.user.id,
          createdAt: await this.database.time(tx),
        },
      });
    });
  }
  async createShelf(
    context: AuthenticationContext,
    input: CreateStorageShelfDto,
  ) {
    return this.mutations.run(context, [], async (tx) => {
      const row = await tx.storageRow.findUnique({
        where: { id: input.rowId },
      });
      const merchant = await tx.merchant.findUnique({
        where: { id: input.merchantId },
      });
      if (!row || !merchant)
        throw new NotFoundException('Row or merchant not found');
      if (!row.isActive || !merchant.isActive)
        throw new ConflictException('Row and merchant must be active');
      return tx.storageShelf.create({
        data: {
          warehouseId: row.warehouseId,
          rowId: row.id,
          merchantId: merchant.id,
          code: input.code,
          name: input.name,
          createdById: context.user.id,
          createdAt: await this.database.time(tx),
        },
      });
    });
  }
  async update(
    context: AuthenticationContext,
    id: string,
    input: UpdateStorageLocationDto,
    kind: 'ROW' | 'SHELF',
  ) {
    if (input.name === undefined && input.isActive === undefined)
      throw new BadRequestException('At least one field is required');
    return this.mutations.run(context, [], async (tx) => {
      const location =
        kind === 'ROW'
          ? await tx.storageRow.findUnique({ where: { id } })
          : await tx.storageShelf.findUnique({ where: { id } });
      if (!location) throw new NotFoundException('Location not found');
      // Locks precede checking contents, including transfers and concurrent receipt allocations.
      if (kind === 'ROW')
        await tx.$queryRaw`SELECT id FROM storage_rows WHERE id=${id}::uuid FOR UPDATE`;
      else
        await tx.$queryRaw`SELECT id FROM storage_shelves WHERE id=${id}::uuid FOR UPDATE`;
      if (input.isActive === false) {
        const shelves =
          kind === 'ROW'
            ? (
                await tx.storageShelf.findMany({
                  where: { rowId: id },
                  select: { id: true },
                })
              ).map((s) => s.id)
            : [id];
        if (
          shelves.length &&
          ((await tx.stockPlacementBalance.count({
            where: { shelfId: { in: shelves }, quantity: { gt: 0 } },
          })) ||
            (await tx.returnCustodyBalance.count({
              where: { shelfId: { in: shelves }, quantity: { gt: 0 } },
            })))
        )
          throw new ConflictException(
            'Location contains stock or return custody',
          );
      }
      return kind === 'ROW'
        ? tx.storageRow.update({ where: { id }, data: input })
        : tx.storageShelf.update({ where: { id }, data: input });
    });
  }
  async shelves(
    context: AuthenticationContext,
    query: ListStorageLocationsDto,
  ) {
    const merchantId = this.scope(context, query.merchantId);
    const where: Prisma.StorageShelfWhereInput = {
      ...(merchantId ? { merchantId } : {}),
      ...(query.rowId ? { rowId: query.rowId } : {}),
      ...(query.shelfId ? { id: query.shelfId } : {}),
    };
    const [items, total] = await this.database.$transaction(
      [
        this.database.storageShelf.findMany({
          where,
          orderBy: { code: 'asc' },
          skip: (query.page - 1) * query.limit,
          take: query.limit,
        }),
        this.database.storageShelf.count({ where }),
      ],
      { isolationLevel: 'RepeatableRead' },
    );
    return { items, total, page: query.page, limit: query.limit };
  }
  async rows(context: AuthenticationContext, query: ListStorageLocationsDto) {
    const merchantId = this.scope(context, query.merchantId);
    const rows = merchantId
      ? (
          await this.database.storageShelf.findMany({
            where: { merchantId },
            select: { rowId: true },
            distinct: ['rowId'],
          })
        ).map((s) => s.rowId)
      : undefined;
    const where: Prisma.StorageRowWhereInput = {
      ...(rows ? { id: { in: rows } } : {}),
      ...(query.rowId ? { AND: [{ id: query.rowId }] } : {}),
    };
    const [items, total] = await this.database.$transaction(
      [
        this.database.storageRow.findMany({
          where,
          orderBy: { code: 'asc' },
          skip: (query.page - 1) * query.limit,
          take: query.limit,
        }),
        this.database.storageRow.count({ where }),
      ],
      { isolationLevel: 'RepeatableRead' },
    );
    return { items, total, page: query.page, limit: query.limit };
  }
  async balances(
    context: AuthenticationContext,
    query: ListStorageLocationsDto,
    kind: 'AVAILABLE' | 'CUSTODY',
  ) {
    const merchantId = this.scope(context, query.merchantId);
    let shelfIds: string[] | undefined;
    if (query.rowId)
      shelfIds = (
        await this.database.storageShelf.findMany({
          where: { rowId: query.rowId, ...(merchantId ? { merchantId } : {}) },
          select: { id: true },
        })
      ).map((s) => s.id);
    const common = {
      ...(merchantId ? { merchantId } : {}),
      ...(query.itemId ? { itemId: query.itemId } : {}),
      ...(query.shelfId ? { shelfId: query.shelfId } : {}),
      ...(shelfIds ? { AND: [{ shelfId: { in: shelfIds } }] } : {}),
    };
    const paging = {
      skip: (query.page - 1) * query.limit,
      take: query.limit,
      orderBy: { id: 'asc' as const },
    };
    if (kind === 'AVAILABLE') {
      const [items, total] = await this.database.$transaction(
        [
          this.database.stockPlacementBalance.findMany({
            where: common,
            ...paging,
          }),
          this.database.stockPlacementBalance.count({ where: common }),
        ],
        { isolationLevel: 'RepeatableRead' },
      );
      return { items, total, page: query.page, limit: query.limit };
    }
    const [items, total] = await this.database.$transaction(
      [
        this.database.returnCustodyBalance.findMany({
          where: common,
          ...paging,
        }),
        this.database.returnCustodyBalance.count({ where: common }),
      ],
      { isolationLevel: 'RepeatableRead' },
    );
    return { items, total, page: query.page, limit: query.limit };
  }
  async entries(
    context: AuthenticationContext,
    query: ListStorageLocationsDto,
  ) {
    const merchantId = this.scope(context, query.merchantId);
    const where = {
      ...(merchantId ? { merchantId } : {}),
      ...(query.itemId ? { itemId: query.itemId } : {}),
      ...(query.shelfId ? { shelfId: query.shelfId } : {}),
    };
    const [items, total] = await this.database.$transaction(
      [
        this.database.stockPlacementEntry.findMany({
          where,
          orderBy: [{ recordedAt: 'desc' }, { id: 'desc' }],
          skip: (query.page - 1) * query.limit,
          take: query.limit,
        }),
        this.database.stockPlacementEntry.count({ where }),
      ],
      { isolationLevel: 'RepeatableRead' },
    );
    return { items, total, page: query.page, limit: query.limit };
  }
  async transfers(
    context: AuthenticationContext,
    query: ListStorageLocationsDto,
  ) {
    const merchantId = this.scope(context, query.merchantId);
    const where: Prisma.StockPlacementTransferWhereInput = {
      ...(merchantId ? { merchantId } : {}),
      ...(query.itemId ? { itemId: query.itemId } : {}),
      ...(query.shelfId
        ? { OR: [{ fromShelfId: query.shelfId }, { toShelfId: query.shelfId }] }
        : {}),
    };
    const [items, total] = await this.database.$transaction(
      [
        this.database.stockPlacementTransfer.findMany({
          where,
          orderBy: [{ recordedAt: 'desc' }, { id: 'desc' }],
          skip: (query.page - 1) * query.limit,
          take: query.limit,
        }),
        this.database.stockPlacementTransfer.count({ where }),
      ],
      { isolationLevel: 'RepeatableRead' },
    );
    return { items, total, page: query.page, limit: query.limit };
  }
}
