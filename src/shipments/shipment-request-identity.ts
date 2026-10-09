import { createHash } from 'node:crypto';
import { BadRequestException } from '@nestjs/common';

export function shipmentKey(key: string | undefined): string {
  if (
    !key ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      key,
    )
  )
    throw new BadRequestException('A valid Idempotency-Key UUID is required');
  return key.toLowerCase();
}

export function shipmentHash(canonical: object): string {
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}
