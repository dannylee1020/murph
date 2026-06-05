import { getStore } from '#app/server/persistence/store';
import { rebuildMemoryPagesForRun } from '#app/server/memory/wiki';

const DEFAULT_BATCH_SIZE = 10;

export class MemoryIndexWorker {
  private readonly store = getStore();
  private running = false;

  enqueue(runId: string): void {
    this.store.markMemoryIndexQueued(runId);
    void this.drain();
  }

  async drain(limit = DEFAULT_BATCH_SIZE): Promise<void> {
    if (this.running) {
      return;
    }
    this.running = true;
    try {
      const runs = this.store.listMemoryIndexBacklog(limit);
      for (const run of runs) {
        await this.indexRun(run.id);
      }
    } finally {
      this.running = false;
    }
  }

  async indexRun(runId: string): Promise<void> {
    const run = this.store.getAgentRun(runId);
    if (!run || run.status !== 'completed') {
      return;
    }

    try {
      const result = await rebuildMemoryPagesForRun(run);
      this.store.markMemoryIndexIndexed(
        run.id,
        result.contentHash,
        result.pageCount > 0 ? 'indexed' : 'skipped'
      );
      this.store.appendAgentRunEvent({
        runId: run.id,
        type: 'agent.memory.indexed',
        payload: {
          status: result.pageCount > 0 ? 'indexed' : 'skipped',
          pageCount: result.pageCount,
          pagePaths: result.pagePaths
        }
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Memory indexing failed';
      this.store.markMemoryIndexFailed(run.id, message);
      this.store.appendAgentRunEvent({
        runId: run.id,
        type: 'agent.memory.index_failed',
        payload: { error: message }
      });
    }
  }
}

let worker: MemoryIndexWorker | null = null;

export function getMemoryIndexWorker(): MemoryIndexWorker {
  if (!worker) {
    worker = new MemoryIndexWorker();
  }
  return worker;
}
