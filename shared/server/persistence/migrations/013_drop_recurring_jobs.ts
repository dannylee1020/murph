import type { Migration } from './types.js';

export const dropRecurringJobs: Migration = {
  id: '013_drop_recurring_jobs',
  description: 'remove scheduled morning digest recurring jobs',
  up(db) {
    db.exec(`
      DROP INDEX IF EXISTS idx_recurring_jobs_due;
      DROP TABLE IF EXISTS recurring_jobs;
    `);
  }
};
