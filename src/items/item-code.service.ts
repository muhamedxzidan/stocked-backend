import { ConflictException, Injectable } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client.js';
@Injectable()
export class ItemCodeService {
  async allocate(
    transaction: Prisma.TransactionClient,
    merchantId: string,
    prefix: string,
  ) {
    const [counter] = await transaction.$queryRaw<{ last_value: bigint }[]>`
   INSERT INTO item_code_sequences(merchant_id, last_value) VALUES (${merchantId}::uuid, 1)
   ON CONFLICT (merchant_id) DO UPDATE SET last_value = item_code_sequences.last_value + 1
    WHERE item_code_sequences.last_value < 9223372036854775807
   RETURNING last_value`;
    if (!counter) throw new ConflictException('Item code sequence exhausted');
    return {
      ordinal: counter.last_value,
      code: `${prefix}-${counter.last_value.toString().padStart(6, '0')}`,
    };
  }
}
