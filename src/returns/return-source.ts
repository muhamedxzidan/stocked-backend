import { ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';

// Shared lock order for all return stages; documents themselves remain immutable.
export async function lockReturnShipment(
  tx: Prisma.TransactionClient,
  shipmentId: string,
  merchantId: string,
) {
  const [merchant] = await tx.$queryRaw<
    { name: string; is_active: boolean }[]
  >`SELECT name,is_active FROM merchants WHERE id=${merchantId}::uuid FOR SHARE`;
  if (!merchant) throw new NotFoundException('Merchant not found');
  if (!merchant.is_active) throw new ConflictException('Merchant is inactive');
  const rows = await tx.$queryRaw<
    { id: string }[]
  >`SELECT id FROM shipments WHERE id=${shipmentId}::uuid AND merchant_id=${merchantId}::uuid FOR UPDATE`;
  if (!rows.length) throw new NotFoundException('Shipment not found');
  const shipment = await tx.shipment.findUniqueOrThrow({
    where: { id: shipmentId },
    include: { dispatch: true, lines: { orderBy: { position: 'asc' } } },
  });
  if (!shipment.dispatch)
    throw new ConflictException('Only dispatched shipments can be returned');
  return { shipment, merchant };
}
export async function lockReturnReceipt(
  tx: Prisma.TransactionClient,
  id: string,
) {
  const receipt = await tx.returnReceipt.findUnique({
    where: { id },
    include: { lines: { orderBy: { position: 'asc' } } },
  });
  if (!receipt) throw new NotFoundException('Return receipt not found');
  await lockReturnShipment(tx, receipt.shipmentId, receipt.merchantId);
  await tx.$queryRaw`SELECT id FROM return_receipts WHERE id=${id}::uuid FOR UPDATE`;
  return receipt;
}
export async function lockReturnItems(
  tx: Prisma.TransactionClient,
  itemIds: readonly string[],
  merchantId: string,
  activeIds: ReadonlySet<string>,
) {
  const ids = [...new Set(itemIds)].sort();
  const items = await tx.$queryRaw<
    { id: string; merchant_id: string; is_active: boolean }[]
  >`SELECT id,merchant_id,is_active FROM items WHERE id IN (${Prisma.join(ids.map((id) => Prisma.sql`${id}::uuid`))}) ORDER BY id FOR SHARE`;
  if (
    items.length !== ids.length ||
    items.some(
      (item) =>
        item.merchant_id !== merchantId ||
        (activeIds.has(item.id) && !item.is_active),
    )
  )
    throw new ConflictException('Return item is unavailable for restocking');
}
