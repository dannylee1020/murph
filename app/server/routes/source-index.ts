import { getStore } from '../persistence/store.js';
import { getSourceIndexWorker } from '../source-index/worker.js';
import { getSourceIndexScheduler } from '../source-index/scheduler.js';
import { readJson, sendJson } from '../http.js';
import { route, type Route } from '../router.js';

interface RefreshBody {
  workspaceId?: string;
  providers?: string[];
}

function resolveWorkspaceId(url: URL): string | undefined {
  const requested = url.searchParams.get('workspaceId')?.trim();
  if (requested) {
    return requested;
  }
  return getStore().getFirstWorkspace()?.id;
}

export const sourceIndexRoutes: Route[] = [
  route('GET', '/api/source-index/status', ({ res, url }) => {
    const workspaceId = resolveWorkspaceId(url);
    sendJson(res, {
      ok: true,
      workspaceId,
      scheduler: getSourceIndexScheduler().status(workspaceId),
      runs: getStore().listSourceIndexRuns({ workspaceId, limit: 20 })
    });
  }),
  route('POST', '/api/source-index/refresh', async ({ req, res, url }) => {
    const body = await readJson<RefreshBody>(req);
    const workspaceId = body.workspaceId?.trim() || resolveWorkspaceId(url);
    if (!workspaceId) {
      sendJson(res, { ok: false, error: 'workspace_required' }, 400);
      return;
    }
    try {
      const providers = Array.isArray(body.providers)
        ? body.providers.filter((provider): provider is string => typeof provider === 'string' && provider.trim().length > 0).map((provider) => provider.trim())
        : undefined;
      const result = await getSourceIndexWorker().refresh({ workspaceId, providers, reason: 'manual' });
      sendJson(res, {
        ok: true,
        ...result
      });
    } catch (error) {
      sendJson(res, {
        ok: false,
        error: error instanceof Error ? error.message : 'source_index_refresh_failed'
      }, 400);
    }
  })
];
