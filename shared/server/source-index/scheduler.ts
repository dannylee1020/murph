import { getRuntimeEnv } from '../util/env.js';
import { getStore } from '../persistence/store.js';
import { sourceIndexProviderIdsForCurrentRuntime, validateSourceIndexProvidersForCurrentRuntime } from './providers.js';
import { getSourceIndexWorker, type SourceIndexRefreshResult } from './worker.js';

export interface SourceIndexProviderStatus {
  provider: string;
  status: 'due' | 'fresh' | 'retry_due' | 'retry_wait' | 'running' | 'never_indexed';
  resourceCount: number;
  lastRunAt?: string;
  nextDueAt?: string;
  error?: string;
}

export interface SourceIndexSchedulerStatus {
  enabled: boolean;
  running: boolean;
  distribution: string;
  intervalMs: number;
  retryIntervalMs: number;
  workspaces: Array<{
    workspaceId: string;
    providers: SourceIndexProviderStatus[];
  }>;
}

function addMs(value: string, ms: number): string {
  const time = new Date(value).getTime();
  const offset = Number.isFinite(ms) ? ms : 0;
  return new Date((Number.isFinite(time) ? time : Date.now()) + offset).toISOString();
}

function isPastOrEqual(value: string, now: Date): boolean {
  return new Date(value).getTime() <= now.getTime();
}

export class SourceIndexScheduler {
  private readonly store = getStore();
  private readonly worker = getSourceIndexWorker();
  private running = false;

  async tick(reason = 'heartbeat', now = new Date()): Promise<SourceIndexRefreshResult[]> {
    const env = getRuntimeEnv();
    if (!env.sourceIndexEnabled || this.running) {
      return [];
    }
    this.running = true;
    try {
      const results: SourceIndexRefreshResult[] = [];
      for (const workspace of this.store.listWorkspaces()) {
        const providers = this.dueProviders(workspace.id, now);
        if (providers.length === 0) {
          continue;
        }
        try {
          results.push(await this.worker.refresh({ workspaceId: workspace.id, providers, reason }));
        } catch (error) {
          console.warn('[source-index] scheduled refresh failed:', error instanceof Error ? error.message : error);
        }
      }
      return results;
    } finally {
      this.running = false;
    }
  }

  async triggerWorkspace(input: { workspaceId: string; providers?: string[]; reason: string }): Promise<SourceIndexRefreshResult | undefined> {
    const env = getRuntimeEnv();
    if (!env.sourceIndexEnabled || this.running) {
      return undefined;
    }
    const providers = input.providers
      ? validateSourceIndexProvidersForCurrentRuntime(input.providers)
      : sourceIndexProviderIdsForCurrentRuntime();
    this.running = true;
    try {
      return await this.worker.refresh({
        workspaceId: input.workspaceId,
        providers,
        reason: input.reason
      });
    } finally {
      this.running = false;
    }
  }

  status(workspaceId?: string, now = new Date()): SourceIndexSchedulerStatus {
    const env = getRuntimeEnv();
    const workspaces = (workspaceId
      ? this.store.listWorkspaces().filter((workspace) => workspace.id === workspaceId)
      : this.store.listWorkspaces()
    ).map((workspace) => ({
      workspaceId: workspace.id,
      providers: sourceIndexProviderIdsForCurrentRuntime().map((provider) =>
        this.providerStatus(workspace.id, provider, now)
      )
    }));
    return {
      enabled: env.sourceIndexEnabled,
      running: this.running,
      distribution: env.distribution,
      intervalMs: env.sourceIndexIntervalMs,
      retryIntervalMs: env.sourceIndexRetryIntervalMs,
      workspaces
    };
  }

  private dueProviders(workspaceId: string, now: Date): string[] {
    return sourceIndexProviderIdsForCurrentRuntime()
      .filter((provider) => {
        const status = this.providerStatus(workspaceId, provider, now);
        return status.status === 'never_indexed' || status.status === 'due' || status.status === 'retry_due';
      });
  }

  private providerStatus(workspaceId: string, provider: string, now: Date): SourceIndexProviderStatus {
    const env = getRuntimeEnv();
    const latest = this.store.latestSourceIndexRunForProvider({ workspaceId, provider });
    if (!latest) {
      return { provider, status: 'never_indexed', resourceCount: 0 };
    }
    if (latest.status === 'running') {
      return {
        provider,
        status: 'running',
        resourceCount: latest.resourceCount,
        lastRunAt: latest.updatedAt,
        error: latest.error
      };
    }
    const interval = latest.status === 'failed' ? env.sourceIndexRetryIntervalMs : env.sourceIndexIntervalMs;
    const nextDueAt = addMs(latest.updatedAt, interval);
    const due = isPastOrEqual(nextDueAt, now);
    return {
      provider,
      status: latest.status === 'failed'
        ? due ? 'retry_due' : 'retry_wait'
        : due ? 'due' : 'fresh',
      resourceCount: latest.resourceCount,
      lastRunAt: latest.updatedAt,
      nextDueAt,
      error: latest.error
    };
  }
}

let scheduler: SourceIndexScheduler | null = null;

export function getSourceIndexScheduler(): SourceIndexScheduler {
  if (!scheduler) {
    scheduler = new SourceIndexScheduler();
  }
  return scheduler;
}
