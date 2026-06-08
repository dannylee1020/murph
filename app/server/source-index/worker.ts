import { randomUUID } from 'node:crypto';
import { getStore } from '../persistence/store.js';
import { getSourceIndexCatalog } from './catalog.js';
import {
  getSourceIndexProvider,
  sourceIndexProviderIdsForCurrentRuntime,
  validateSourceIndexProvidersForCurrentRuntime
} from './providers.js';
import { summarizeChangedSourceIndexResources, type SourceIndexSummaryResult } from './summarizer.js';

export interface SourceIndexRefreshResult {
  workspaceId: string;
  reason?: string;
  summaries?: SourceIndexSummaryResult;
  runs: Array<{
    provider: string;
    status: string;
    resourceCount: number;
    changedPaths: string[];
    error?: string;
  }>;
}

export interface SourceIndexRefreshInput {
  workspaceId: string;
  providers?: string[];
  reason?: string;
}

export class SourceIndexWorker {
  private readonly store = getStore();
  private running = false;

  async refresh(input: string | SourceIndexRefreshInput): Promise<SourceIndexRefreshResult> {
    if (this.running) {
      throw new Error('Source index refresh is already running');
    }
    const request = typeof input === 'string' ? { workspaceId: input } : input;
    const providers = request.providers
      ? validateSourceIndexProvidersForCurrentRuntime(request.providers)
      : sourceIndexProviderIdsForCurrentRuntime();
    this.running = true;
    const runs: SourceIndexRefreshResult['runs'] = [];
    try {
      const results = await Promise.allSettled(providers.map(async (provider) => {
        const definition = getSourceIndexProvider(provider);
        if (!definition) {
          throw new Error(`Unsupported source index provider: ${provider}`);
        }
        const runId = randomUUID();
        this.store.startSourceIndexRun({ id: runId, workspaceId: request.workspaceId, provider });
        try {
          const result = await definition.index(request.workspaceId);
          const status = result.resourceCount > 0 ? 'indexed' : 'skipped';
          this.store.finishSourceIndexRun({
            id: runId,
            status,
            resourceCount: result.resourceCount,
            changedPaths: result.changedPaths,
            cursor: 'cursor' in result && typeof result.cursor === 'string' ? result.cursor : undefined
          });
          return {
            provider,
            status,
            resourceCount: result.resourceCount,
            changedPaths: result.changedPaths
          };
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Source index refresh failed';
          this.store.failSourceIndexRun({ id: runId, error: message });
          return { provider, status: 'failed', resourceCount: 0, changedPaths: [], error: message };
        }
      }));
      for (const result of results) {
        if (result.status === 'fulfilled') {
          runs.push(result.value);
        } else {
          runs.push({
            provider: 'unknown',
            status: 'failed',
            resourceCount: 0,
            changedPaths: [],
            error: result.reason instanceof Error ? result.reason.message : 'Source index refresh failed'
          });
        }
      }
      const summaries = await summarizeChangedSourceIndexResources({
        workspaceId: request.workspaceId,
        changedPaths: runs.flatMap((run) => run.changedPaths)
      });
      await getSourceIndexCatalog().reload();
      return { workspaceId: request.workspaceId, reason: request.reason, summaries, runs };
    } finally {
      this.running = false;
    }
  }
}

let worker: SourceIndexWorker | null = null;

export function getSourceIndexWorker(): SourceIndexWorker {
  if (!worker) {
    worker = new SourceIndexWorker();
  }
  return worker;
}
