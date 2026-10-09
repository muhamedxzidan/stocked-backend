import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, UserRole } from '../generated/prisma/client.js';
import { PrismaService } from '../database/prisma.service.js';
import type { AuthenticationContext } from '../auth/authenticated-user.js';
import { ListReturnsDto, ReturnStatus } from './dto/list-returns.dto.js';
import { returnReadSelect } from './return-select.js';
type ReturnRead = Prisma.ReturnReceiptGetPayload<{
  select: typeof returnReadSelect;
}>;

@Injectable()
export class ReturnsReadService {
  constructor(
    @Inject(PrismaService) private readonly database: PrismaService,
  ) {}
  async list(context: AuthenticationContext, query: ListReturnsDto) {
    if (query.from && query.to && new Date(query.from) >= new Date(query.to))
      throw new BadRequestException('from must be earlier than to');
    const merchantId = this.scope(context, query.merchantId);
    const pending = { condition: 'NOTED' as const, review: { is: null } };
    const where: Prisma.ReturnReceiptWhereInput = {
      ...(merchantId ? { merchantId } : {}),
      ...(query.shipmentId
        ? { shipmentId: query.shipmentId.toLowerCase() }
        : {}),
      ...(query.itemId
        ? { lines: { some: { itemId: query.itemId.toLowerCase() } } }
        : {}),
      ...(query.receiverId
        ? { receivedById: query.receiverId.toLowerCase() }
        : {}),
      ...(query.inspectorId
        ? {
            inspection: {
              is: { inspectedById: query.inspectorId.toLowerCase() },
            },
          }
        : {}),
      ...(query.reviewerId
        ? {
            inspection: {
              is: {
                ...(query.inspectorId
                  ? { inspectedById: query.inspectorId.toLowerCase() }
                  : {}),
                lines: {
                  some: {
                    review: {
                      is: { reviewedById: query.reviewerId.toLowerCase() },
                    },
                  },
                },
              },
            },
          }
        : {}),
      ...(query.from || query.to
        ? {
            receivedAt: {
              ...(query.from ? { gte: new Date(query.from) } : {}),
              ...(query.to ? { lt: new Date(query.to) } : {}),
            },
          }
        : {}),
    };
    const statusWhere: Prisma.ReturnReceiptWhereInput | undefined =
      query.status === ReturnStatus.RECEIVED
        ? { inspection: { is: null } }
        : query.status === ReturnStatus.PENDING_REVIEW
          ? { inspection: { is: { lines: { some: pending } } } }
          : query.status === ReturnStatus.RESOLVED
            ? { inspection: { is: { lines: { none: pending } } } }
            : undefined;
    if (statusWhere) where.AND = [statusWhere];
    const [rows, total] = await this.database.$transaction(
      [
        this.database.returnReceipt.findMany({
          where,
          select: returnReadSelect,
          skip: (query.page - 1) * query.limit,
          take: query.limit,
          orderBy: [{ receivedAt: 'desc' }, { id: 'desc' }],
        }),
        this.database.returnReceipt.count({ where }),
      ],
      { isolationLevel: 'RepeatableRead' },
    );
    return {
      items: rows.map((row) => this.present(row)),
      total,
      page: query.page,
      limit: query.limit,
    };
  }
  async get(context: AuthenticationContext, id: string) {
    const merchantId = this.scope(context);
    const receipt = await this.database.$transaction(
      (tx) =>
        tx.returnReceipt.findFirst({
          where: {
            id: id.toLowerCase(),
            ...(merchantId ? { merchantId } : {}),
          },
          select: returnReadSelect,
        }),
      { isolationLevel: 'RepeatableRead' },
    );
    if (!receipt) throw new NotFoundException('Return receipt not found');
    return this.present(receipt);
  }
  private scope(context: AuthenticationContext, requested?: string) {
    const normalized = requested?.toLowerCase();
    if (context.user.role === UserRole.MERCHANT) {
      if (
        !context.user.merchantId ||
        (normalized && normalized !== context.user.merchantId)
      )
        throw new ForbiddenException('Access denied');
      return context.user.merchantId;
    }
    return normalized;
  }
  private present(receipt: ReturnRead) {
    const groups =
      receipt.inspection?.lines.map((g) => ({
        ...g,
        status:
          g.condition === 'GOOD'
            ? 'GOOD_RESTOCKED'
            : !g.review
              ? 'PENDING_REVIEW'
              : g.review.decision === 'ACCEPT_TO_STOCK'
                ? 'ACCEPTED_TO_STOCK'
                : 'REJECTED_OUTSIDE_STOCK',
      })) ?? [];
    const received = receipt.lines.reduce((n, l) => n + l.quantity, 0);
    const pending = groups
      .filter((g) => g.status === 'PENDING_REVIEW')
      .reduce((n, g) => n + g.quantity, 0);
    const restocked = groups
      .filter(
        (g) =>
          g.status === 'GOOD_RESTOCKED' || g.status === 'ACCEPTED_TO_STOCK',
      )
      .reduce((n, g) => n + g.quantity, 0);
    const rejected = groups
      .filter((g) => g.status === 'REJECTED_OUTSIDE_STOCK')
      .reduce((n, g) => n + g.quantity, 0);
    const timeline: {
      step: string;
      actorId: string;
      actorNameSnapshot: string;
      recordedAt: Date;
      inspectionLineId?: string;
    }[] = [
      {
        step: 'RECEIVED',
        actorId: receipt.receivedById,
        actorNameSnapshot: receipt.receivedByNameSnapshot,
        recordedAt: receipt.receivedAt,
      },
    ];
    if (receipt.inspection)
      timeline.push({
        step: 'INSPECTED',
        actorId: receipt.inspection.inspectedById,
        actorNameSnapshot: receipt.inspection.inspectedByNameSnapshot,
        recordedAt: receipt.inspection.inspectedAt,
      });
    const reviews = groups
      .flatMap((g) =>
        g.review
          ? [
              {
                step: g.review.decision,
                actorId: g.review.reviewedById,
                actorNameSnapshot: g.review.reviewedByNameSnapshot,
                recordedAt: g.review.reviewedAt,
                inspectionLineId: g.id,
              },
            ]
          : [],
      )
      .sort(
        (a, b) =>
          a.recordedAt.getTime() - b.recordedAt.getTime() ||
          a.inspectionLineId.localeCompare(b.inspectionLineId),
      );
    timeline.push(...reviews);
    return {
      ...receipt,
      inspection: receipt.inspection
        ? { ...receipt.inspection, lines: groups }
        : null,
      status: !receipt.inspection
        ? ReturnStatus.RECEIVED
        : pending
          ? ReturnStatus.PENDING_REVIEW
          : ReturnStatus.RESOLVED,
      quantities: {
        received,
        uninspected: receipt.inspection ? 0 : received,
        restocked,
        pending,
        rejected,
      },
      timeline,
    };
  }
}
