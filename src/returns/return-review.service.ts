import { canonicalShelfAllocations } from '../inventory/stock-placement-input.js';
import { ReturnCustodyPlacementService } from '../inventory/return-custody-placement.service.js';
import { StockPlacementService } from '../inventory/stock-placement.service.js';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import type { AuthenticationContext } from '../auth/authenticated-user.js';
import { StockMutationService } from '../inventory/stock-mutation.service.js';
import { StockPostingService } from '../inventory/stock-posting.service.js';
import type { ReviewReturnDto } from './dto/review-return.dto.js';
import { returnHash, returnKey } from './return-request-identity.js';
import { reviewSelect, returnReviewerRoles } from './return-select.js';
import { lockReturnItems, lockReturnReceipt } from './return-source.js';

@Injectable()
export class ReturnReviewService {
  constructor(
    @Inject(ReturnCustodyPlacementService)
    private readonly custody: ReturnCustodyPlacementService,
    @Inject(StockPlacementService)
    private readonly placements: StockPlacementService,
    @Inject(PrismaService) private readonly database: PrismaService,
    @Inject(StockMutationService)
    private readonly mutations: StockMutationService,
    @Inject(StockPostingService) private readonly posting: StockPostingService,
  ) {}
  async review(
    context: AuthenticationContext,
    id: string,
    key: string | undefined,
    input: ReviewReturnDto,
  ) {
    const inspectionLineId = id.toLowerCase(),
      idempotencyKey = returnKey(key);
    const canonical = {
        inspectionLineId,
        decision: input.decision,
        reason: input.reason.trim(),
        placements: canonicalShelfAllocations(input.placements),
        custodySources: canonicalShelfAllocations(input.custodySources),
      },
      requestHash = returnHash(canonical);
    return this.mutations.run(
      context,
      'return_review',
      idempotencyKey,
      returnReviewerRoles,
      async (tx, current) => {
        const warehouse = await tx.warehouse.findUnique({
          where: { code: 'MAIN' },
          select: { id: true },
        });
        if (!warehouse)
          throw new ConflictException('Main warehouse is not initialized');
        const previous = await tx.returnReview.findUnique({
          where: {
            warehouseId_idempotencyKey: {
              warehouseId: warehouse.id,
              idempotencyKey,
            },
          },
        });
        if (previous) {
          if (
            previous.reviewedById !== current.user.id ||
            previous.requestHash !== requestHash
          )
            throw new ConflictException('Idempotency key is already used');
          return {
            replayed: true,
            review: await tx.returnReview.findUniqueOrThrow({
              where: { id: previous.id },
              select: reviewSelect,
            }),
          };
        }
        const group = await tx.returnInspectionLine.findUnique({
          where: { id: inspectionLineId },
          include: { receiptLine: true },
        });
        if (!group) throw new NotFoundException('Inspection group not found');
        const receipt = await lockReturnReceipt(tx, group.receiptId);
        if (group.condition !== 'NOTED')
          throw new BadRequestException('Only noted groups require review');
        if (
          await tx.returnReview.findUnique({
            where: { inspectionLineId },
            select: { id: true },
          })
        )
          throw new ConflictException('Group is already reviewed');
        const accepted = canonical.decision === 'ACCEPT_TO_STOCK';
        if (!accepted && (input.placements || input.custodySources))
          throw new BadRequestException(
            'Rejected groups cannot include stock allocations',
          );
        if (accepted && group.issueType === 'MISMATCH')
          throw new BadRequestException(
            'A mismatched item cannot restock the expected SKU',
          );
        await lockReturnItems(
          tx,
          [group.itemId],
          receipt.merchantId,
          new Set(accepted ? [group.itemId] : []),
        );
        const deltas = new Map([[group.itemId, group.quantity]]);
        const balances = accepted
          ? await this.posting.lockBalances(
              tx,
              receipt.warehouseId,
              receipt.merchantId,
              [group.itemId],
            )
          : null;
        if (balances) this.posting.assertWithinRange(balances, deltas);
        const verified = await this.mutations.revalidate(
          tx,
          current,
          returnReviewerRoles,
        );
        const reviewedAt = await this.database.time(tx);
        const review = await tx.returnReview.create({
          data: {
            inspectionLineId,
            warehouseId: receipt.warehouseId,
            merchantId: receipt.merchantId,
            itemId: group.itemId,
            decision: canonical.decision,
            reason: canonical.reason,
            reviewedById: verified.user.id,
            reviewedByNameSnapshot: verified.user.displayName,
            reviewedAt,
            idempotencyKey,
            requestHash,
          },
          select: reviewSelect,
        });
        if (balances) {
          const movement = await tx.stockMovement.create({
            data: {
              warehouseId: receipt.warehouseId,
              merchantId: receipt.merchantId,
              itemId: group.itemId,
              itemCodeSnapshot: group.receiptLine.itemCodeSnapshot,
              itemNameSnapshot: group.receiptLine.itemNameSnapshot,
              kind: 'RETURN_IN',
              quantityDelta: group.quantity,
              actorId: verified.user.id,
              actorNameSnapshot: verified.user.displayName,
              recordedAt: reviewedAt,
              returnInspectionLineId: group.id,
              returnReviewId: review.id,
            },
          });
          await this.placements.allocateMovement(
            tx,
            movement,
            input.placements,
          );
          await this.custody.release(
            tx,
            movement,
            input.custodySources ?? input.placements,
          );
          await this.posting.apply(tx, balances, deltas, reviewedAt);
        }
        return { replayed: false, review };
      },
    );
  }
}
