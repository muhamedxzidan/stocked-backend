import { Prisma, UserRole } from '../generated/prisma/client.js';
export const returnWriterRoles = [
  UserRole.ADMIN,
  UserRole.WAREHOUSE_KEEPER,
  UserRole.EMPLOYEE,
] as const;
export const returnReviewerRoles = [
  UserRole.ADMIN,
  UserRole.WAREHOUSE_KEEPER,
] as const;
export const reviewSelect = {
  id: true,
  inspectionLineId: true,
  decision: true,
  reason: true,
  reviewedById: true,
  reviewedByNameSnapshot: true,
  reviewedAt: true,
} satisfies Prisma.ReturnReviewSelect;
export const inspectionSelect = {
  id: true,
  receiptId: true,
  inspectedById: true,
  inspectedByNameSnapshot: true,
  inspectedAt: true,
  lines: {
    orderBy: { position: 'asc' as const },
    select: {
      id: true,
      receiptLineId: true,
      itemId: true,
      position: true,
      quantity: true,
      condition: true,
      issueType: true,
      notes: true,
    },
  },
} satisfies Prisma.ReturnInspectionSelect;
export const returnReceiptSelect = {
  id: true,
  merchantId: true,
  shipmentId: true,
  dispatchId: true,
  merchantNameSnapshot: true,
  shipmentCodeSnapshot: true,
  receivedById: true,
  receivedByNameSnapshot: true,
  receivedAt: true,
  notes: true,
  lines: {
    orderBy: { position: 'asc' as const },
    select: {
      id: true,
      shipmentLineId: true,
      itemId: true,
      position: true,
      quantity: true,
      itemCodeSnapshot: true,
      itemNameSnapshot: true,
    },
  },
} satisfies Prisma.ReturnReceiptSelect;
export const returnReadSelect = {
  ...returnReceiptSelect,
  inspection: {
    select: {
      ...inspectionSelect,
      lines: {
        ...inspectionSelect.lines,
        select: {
          ...inspectionSelect.lines.select,
          review: { select: reviewSelect },
        },
      },
    },
  },
} satisfies Prisma.ReturnReceiptSelect;
