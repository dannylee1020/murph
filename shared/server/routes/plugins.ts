import { ensureRuntimeInitialized } from '#shared/server/runtime/bootstrap';
import { getChannelRegistry } from '#shared/server/capabilities/channel-registry';
import { refreshRuntimeState } from '#shared/server/runtime/refresh';
import {
  listScopedPluginStatuses,
  reloadScopedPlugins
} from '#shared/server/plugins/loader';
import { sendJson } from '../http.js';
import { route, type Route } from '../router.js';

export const pluginRoutes: Route[] = [
  route('GET', '/api/plugins/status', async ({ res }) => {
    await ensureRuntimeInitialized();
    sendJson(res, {
      ok: true,
      plugins: listScopedPluginStatuses()
    });
  }),
  route('POST', '/api/plugins/reload', async ({ res }) => {
    await ensureRuntimeInitialized();
    const plugins = await reloadScopedPlugins();
    await getChannelRegistry().startIngress();
    const refresh = await refreshRuntimeState({
      reason: 'plugin_reload',
      deferIfRunActive: true
    });
    sendJson(res, {
      ok: true,
      plugins,
      refresh
    });
  })
];
