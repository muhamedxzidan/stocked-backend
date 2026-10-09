import { ConflictException, Injectable } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client.js';

@Injectable()
export class ShipmentCodeService {
  async allocate(
    tx: Prisma.TransactionClient,
    warehouseId: string,
  ): Promise<string> {
    const [counter] = await tx.$queryRaw<{ last_value: bigint }[]>`
      INSERT INTO shipment_code_sequences (warehouse_id, last_value) VALUES (${warehouseId}::uuid, 1)
      ON CONFLICT (warehouse_id) DO UPDATE SET last_value = shipment_code_sequences.last_value + 1
      WHERE shipment_code_sequences.last_value < 9223372036854775807 RETURNING last_value`;
    if (!counter)
      throw new ConflictException('Shipment code sequence exhausted');
    return `SH-${counter.last_value.toString().padStart(6, '0')}`;
  }
}
