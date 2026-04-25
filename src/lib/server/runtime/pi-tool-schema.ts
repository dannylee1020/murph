import { Type, type TSchema } from 'typebox';

const EMPTY_OBJECT_SCHEMA = {
  type: 'object',
  properties: {},
  additionalProperties: false
} satisfies Record<string, unknown>;

export function toTypeBoxSchema(schema?: Record<string, unknown>): TSchema {
  const normalized = schema ?? EMPTY_OBJECT_SCHEMA;

  if (normalized.type === 'object' && !('properties' in normalized)) {
    return Type.Unsafe({
      ...normalized,
      properties: {}
    });
  }

  return Type.Unsafe(normalized);
}
