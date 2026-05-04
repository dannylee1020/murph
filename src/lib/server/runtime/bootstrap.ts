import { registerBuiltInTools } from '#lib/server/capabilities/builtins';
import { getDiscordGatewayClient } from '#lib/server/channels/discord/gateway-client';
import { loadRuntimePlugins } from '#lib/server/capabilities/plugins';
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
      getDiscordGatewayClient().ensureStarted();
      await loadRuntimePlugins();
      reconcileIntegrationCapabilities();
      initialized = true;
    })().finally(() => {
      pending = null;
    });
  }

  await pending;
}
