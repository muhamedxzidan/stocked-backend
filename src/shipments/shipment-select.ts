import { Prisma, UserRole } from '../generated/prisma/client.js';

export const shipmentWriterRoles = [
  UserRole.ADMIN,
  UserRole.WAREHOUSE_KEEPER,
  UserRole.EMPLOYEE,
] as const;
export const registrationSelect = {
  id: true,
  code: true,
  merchantId: true,
  merchantNameSnapshot: true,
  registeredById: true,
  registeredByNameSnapshot: true,
  registeredAt: true,
  notes: true,
  lines: {
    orderBy: { position: 'asc' as const },
    select: {
      id: true,
      itemId: true,
      position: true,
      itemCodeSnapshot: true,
      itemNameSnapshot: true,
      quantity: true,
    },
  },
} satisfies Prisma.ShipmentSelect;
export const preparationSelect = {
  id: true,
  shipmentId: true,
  preparedById: true,
  preparedByNameSnapshot: true,
  preparedAt: true,
} satisfies Prisma.ShipmentPreparationSelect;
export const dispatchSelect = {
  id: true,
  shipmentId: true,
  preparationId: true,
  dispatchedById: true,
  dispatchedByNameSnapshot: true,
  dispatchedAt: true,
  carrierName: true,
  trackingNumber: true,
} satisfies Prisma.ShipmentDispatchSelect;
export const shipmentReadSelect = {
  ...registrationSelect,
  preparation: { select: preparationSelect },
  dispatch: { select: dispatchSelect },
} satisfies Prisma.ShipmentSelect;
