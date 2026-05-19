import { registerBuiltInTools } from '#lib/server/capabilities/builtins';
import { getChannelRegistry } from '#lib/server/capabilities/channel-registry';
import { loadRuntimePlugins } from '#lib/server/capabilities/plugins';
import { loadIntegrationAdapters } from '#lib/server/integrations/adapter-loader';
import { registerBuiltInIntegrationAdapters } from '#lib/server/integrations/register-builtins';
import { loadScopedPlugins } from '#lib/server/plugins/loader';
import { reconcileIntegrationCapabilitiesForWorkspace } from '#lib/server/integrations/capabilities';
import { getStore } from '#lib/server/persistence/store';

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
      reconcileIntegrationCapabilities();
      initialized = true;
    })().finally(() => {
      pending = null;
    });
  }

  await pending;
}
