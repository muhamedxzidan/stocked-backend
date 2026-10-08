import type { Prisma } from '../generated/prisma/client.js';
export const merchantSelection = {
  id: true,
  code: true,
  name: true,
  phone: true,
  isActive: true,
  createdById: true,
  createdAt: true,
  updatedAt: true,
} as const satisfies Prisma.MerchantSelect;
