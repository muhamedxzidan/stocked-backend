import type { Prisma } from '../generated/prisma/client.js';
import type { itemSelection } from './item-selection.js';
import type { ItemResponseDto } from './dto/item-response.dto.js';
type SelectedItem = Prisma.ItemGetPayload<{ select: typeof itemSelection }>;
export function presentItem(item: SelectedItem): ItemResponseDto {
  return { ...item, weightKg: item.weightKg.toFixed(3) };
}
