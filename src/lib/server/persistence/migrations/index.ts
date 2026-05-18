import { createCurrentSchema } from './001_create_current_schema.js';
import { simplifyLocalFirstSchema } from './002_simplify_local_first_schema.js';
import type { Migration } from './types.js';

export const migrations: Migration[] = [
  createCurrentSchema,
  simplifyLocalFirstSchema
];
