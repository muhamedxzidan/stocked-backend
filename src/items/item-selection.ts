import type { Prisma } from '../generated/prisma/client.js';
export const itemSelection = {
  id: true,
  merchantId: true,
  code: true,
  name: true,
  brand: true,
  color: true,
  weightKg: true,
  notes: true,
  isActive: true,
  createdById: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.ItemSelect;
