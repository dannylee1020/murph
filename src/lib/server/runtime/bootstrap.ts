import { registerBuiltInTools } from '#lib/server/capabilities/builtins';
import { getDiscordGatewayClient } from '#lib/server/channels/discord/gateway-client';
import { loadRuntimePlugins } from '#lib/server/capabilities/plugins';

let initialized = false;
let pending: Promise<void> | null = null;

export async function ensureRuntimeInitialized(): Promise<void> {
  if (initialized) {
    return;
  }

  if (!pending) {
    pending = (async () => {
      registerBuiltInTools();
      getDiscordGatewayClient().ensureStarted();
      await loadRuntimePlugins();
      initialized = true;
    })().finally(() => {
      pending = null;
    });
  }

  await pending;
}
