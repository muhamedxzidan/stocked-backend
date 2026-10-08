import type { Prisma } from '../generated/prisma/client.js';
// Select secrets out at the database boundary for every administration response.
export const userSelection = {
  id: true,
  email: true,
  displayName: true,
  role: true,
  merchantId: true,
  isActive: true,
  mustChangePassword: true,
  createdById: true,
  createdAt: true,
  updatedAt: true,
} as const satisfies Prisma.UserSelect;
