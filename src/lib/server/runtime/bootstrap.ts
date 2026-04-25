import { registerBuiltInTools } from '#lib/server/capabilities/builtins';
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
      await loadRuntimePlugins();
      initialized = true;
    })().finally(() => {
      pending = null;
    });
  }

  await pending;
}
