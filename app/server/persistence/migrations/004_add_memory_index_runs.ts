import type { Migration } from './types.js';

export const addMemoryIndexRuns: Migration = {
  id: '004_add_memory_index_runs',
  description: 'historical no-op for removed markdown memory indexing progress',
  up() {}
};
