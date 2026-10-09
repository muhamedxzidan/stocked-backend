import {
  BadRequestException,
  Injectable,
  type PipeTransform,
} from '@nestjs/common';

// Empty DTOs have no validation metadata; enforce this command's empty contract explicitly.
@Injectable()
export class EmptyShipmentBodyPipe implements PipeTransform {
  transform(value: unknown): Record<string, never> {
    if (value === undefined) return {};
    if (
      !value ||
      typeof value !== 'object' ||
      Array.isArray(value) ||
      Object.keys(value).length
    )
      throw new BadRequestException('Preparation accepts an empty object only');
    return {};
  }
}
