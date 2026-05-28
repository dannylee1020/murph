import { registerBuiltInTools } from '#shared/server/capabilities/builtins';
import { getChannelRegistry } from '#shared/server/capabilities/channel-registry';
import { loadRuntimePlugins } from '#shared/server/capabilities/plugins';
import { loadIntegrationAdapters } from '#shared/server/integrations/adapter-loader';
import { registerBuiltInIntegrationAdapters } from '#shared/server/integrations/register-builtins';
import { loadScopedPlugins } from '#shared/server/plugins/loader';
import { reconcileIntegrationCapabilitiesForWorkspace } from '#shared/server/integrations/capabilities';
import { getStore } from '#shared/server/persistence/store';

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
