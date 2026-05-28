import { columnNames, tableExists } from './helpers.js';
import type { Migration } from './types.js';

export const addSubscriptionPolicyMode: Migration = {
  id: '008_add_subscription_policy_mode',
  description: 'track policy execution mode per workspace subscription',
  up(db) {
    if (tableExists(db, 'workspace_subscriptions') && !columnNames(db, 'workspace_subscriptions').has('policy_mode')) {
      db.exec(`ALTER TABLE workspace_subscriptions ADD COLUMN policy_mode TEXT;`);
    }
  }
};
