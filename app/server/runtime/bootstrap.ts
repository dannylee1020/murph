import { registerBuiltInTools } from '#app/server/capabilities/builtins';
import { getChannelRegistry } from '#app/server/capabilities/channel-registry';
import { loadRuntimePlugins } from '#app/server/capabilities/plugins';
import { loadIntegrationAdapters } from '#app/server/integrations/adapter-loader';
import { registerBuiltInIntegrationAdapters } from '#app/server/integrations/register-builtins';
import { loadScopedPlugins } from '#app/server/plugins/loader';
import { reconcileIntegrationCapabilitiesForWorkspace } from '#app/server/integrations/capabilities';
import { getStore } from '#app/server/persistence/store';
import { syncConfigScheduleToSetupOwners } from '#app/server/setup/config-schedule';

let initialized = false;
let pending: Promise<void> | null = null;

function reconcileIntegrationCapabilities(): void {
  try {
    for (const ws of getStore().listWorkspaces()) {
      reconcileIntegrationCapabilitiesForWorkspace(ws.id);
    }
  } catch (error) {
    console.warn('[bootstrap] integration capability reconcile failed:', error instanceof Error ? error.message : error);
  }
}

export async function ensureRuntimeInitialized(): Promise<void> {
  if (initialized) {
    return;
  }

  if (!pending) {
    pending = (async () => {
      registerBuiltInTools();
      registerBuiltInIntegrationAdapters();
      await loadIntegrationAdapters();
      await loadScopedPlugins();
      await loadRuntimePlugins();
      await getChannelRegistry().startIngress();
      syncConfigScheduleToSetupOwners();
      reconcileIntegrationCapabilities();
      initialized = true;
    })().finally(() => {
      pending = null;
    });
  }

  await pending;
}
