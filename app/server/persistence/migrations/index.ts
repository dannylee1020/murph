import { createCurrentSchema } from './001_create_current_schema.js';
import { simplifyLocalFirstSchema } from './002_simplify_local_first_schema.js';
import { addChannelEvents } from './003_add_channel_events.js';
import { addMemoryIndexRuns } from './004_add_memory_index_runs.js';
import { addRuntimeRefreshState } from './005_add_runtime_refresh_state.js';
import { addWorkspaceSubscriptions } from './006_add_workspace_subscriptions.js';
import { addBotInstallations } from './007_add_bot_installations.js';
import { addSubscriptionPolicyMode } from './008_add_subscription_policy_mode.js';
import { scopeThreadMemoryBySubscriber } from './009_scope_thread_memory_by_subscriber.js';
import { addBotAppConfigs } from './010_add_bot_app_configs.js';
import { teamScopedRuntime } from './011_team_scoped_runtime.js';
import { addSourceIndexRuns } from './012_add_source_index_runs.js';
import { dropRecurringJobs } from './013_drop_recurring_jobs.js';
import type { Migration } from './types.js';

export const migrations: Migration[] = [
  createCurrentSchema,
  simplifyLocalFirstSchema,
  addChannelEvents,
  addMemoryIndexRuns,
  addRuntimeRefreshState,
  addWorkspaceSubscriptions,
  addBotInstallations,
  addSubscriptionPolicyMode,
  scopeThreadMemoryBySubscriber,
  addBotAppConfigs,
  teamScopedRuntime,
  addSourceIndexRuns,
  dropRecurringJobs
];
