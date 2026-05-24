import { createCurrentSchema } from './001_create_current_schema.js';
import { simplifyLocalFirstSchema } from './002_simplify_local_first_schema.js';
import { addChannelEvents } from './003_add_channel_events.js';
import { addMemoryIndexRuns } from './004_add_memory_index_runs.js';
import { addRuntimeRefreshState } from './005_add_runtime_refresh_state.js';
import type { Migration } from './types.js';

export const migrations: Migration[] = [
  createCurrentSchema,
  simplifyLocalFirstSchema,
  addChannelEvents,
  addMemoryIndexRuns,
  addRuntimeRefreshState
];
