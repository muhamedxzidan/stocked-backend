import type {
  ItemShelfQuantityDto,
  ShelfQuantityDto,
} from './dto/stock-placement.dto.js';
/** Canonical request values keep UUID case and allocation order out of retry identity. */
export function canonicalShelfAllocations(
  input: readonly ShelfQuantityDto[] | undefined,
) {
  return (
    input
      ?.map((p) => ({ shelfId: p.shelfId.toLowerCase(), quantity: p.quantity }))
      .sort((a, b) => a.shelfId.localeCompare(b.shelfId)) ?? null
  );
}
export function canonicalItemShelfAllocations(
  input: readonly ItemShelfQuantityDto[] | undefined,
) {
  return (
    input
      ?.map((p) => ({
        itemId: p.itemId.toLowerCase(),
        shelfId: p.shelfId.toLowerCase(),
        quantity: p.quantity,
      }))
      .sort(
        (a, b) =>
          a.itemId.localeCompare(b.itemId) ||
          a.shelfId.localeCompare(b.shelfId),
      ) ?? null
  );
}
