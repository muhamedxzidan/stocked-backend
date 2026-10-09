import { expect } from 'vitest';
import type {
  OpenAPIObject,
  ReferenceObject,
  SchemaObject,
} from '@nestjs/swagger';

/** Checks live HTTP JSON against its published contract, including nested sources. */
export function expectOpenApiResponse(
  document: OpenAPIObject,
  schema: SchemaObject | ReferenceObject,
  value: unknown,
): void {
  if (value === null) {
    expect('nullable' in schema && schema.nullable).toBe(true);
    return;
  }
  if ('$ref' in schema) {
    const name = schema.$ref.split('/').pop()!;
    const target = document.components?.schemas?.[name];
    expect(target, `Missing schema ${name}`).toBeDefined();
    if (!target) throw new Error(`Missing schema ${name}`);
    expectOpenApiResponse(document, target, value);
    return;
  }
  if (schema.allOf) {
    for (const child of schema.allOf)
      expectOpenApiResponse(document, child, value);
    return;
  }
  if (schema.enum) expect(schema.enum).toContain(value);
  if (schema.type === 'array') {
    expect(Array.isArray(value)).toBe(true);
    expect(schema.items).toBeDefined();
    if (!schema.items) throw new Error('Array item contract missing');
    for (const item of value as unknown[])
      expectOpenApiResponse(document, schema.items, item);
  } else if (schema.properties) {
    expect(typeof value).toBe('object');
    const object = value as Record<string, unknown>;
    expect(Object.keys(object).sort()).toEqual(
      Object.keys(schema.properties).sort(),
    );
    for (const key of schema.required ?? []) expect(object).toHaveProperty(key);
    for (const [key, child] of Object.entries(schema.properties))
      expectOpenApiResponse(document, child, object[key]);
  } else if (schema.type === 'integer') {
    expect(Number.isInteger(value)).toBe(true);
  } else if (schema.type) {
    expect(typeof value).toBe(schema.type);
  }
  if (schema.format === 'uuid')
    expect(value).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  if (schema.format === 'date-time')
    expect(Number.isFinite(Date.parse(value as string))).toBe(true);
}
