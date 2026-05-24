import { mkdtempSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentRunRecord } from '../../src/lib/types';

function tempPath(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

function completedRun(): AgentRunRecord {
  return {
    id: 'run-1',
    workspaceId: 'workspace-1',
    taskId: 'task-1',
    channelId: 'C123',
    threadTs: '171642.000',
    targetUserId: 'U1',
    status: 'completed',
    startedAt: '2026-05-23T18:00:00.000Z',
    completedAt: '2026-05-23T18:14:00.000Z'
  };
}

describe('markdown memory wiki', () => {
  beforeEach(() => {
    vi.resetModules();
    delete process.env.MURPH_MEMORY_PATH;
    delete process.env.MURPH_SQLITE_PATH;
  });

  it('writes provenance-backed wiki pages and only reads indexed paths', async () => {
    const memoryRoot = tempPath('murph-memory-wiki-');
    process.env.MURPH_MEMORY_PATH = memoryRoot;

    const { writeRunMemoryPage, readMemoryIndex, readMemoryPage } = await import('../../src/lib/server/memory/wiki');
    const result = await writeRunMemoryPage(completedRun(), {
      artifacts: [{
        id: 'notion:page-1',
        source: 'notion',
        type: 'document',
        title: 'Checkout launch plan',
        text: 'Checkout launch is ready once the rate-limit note is resolved.',
        url: 'https://notion.test/page-1'
      }]
    });

    expect(result.evidenceCount).toBe(1);
    expect(result.pagePath).toBe('wiki/threads/workspace-workspace-1/c123-171642.000.md');
    const index = await readMemoryIndex();
    expect(index).toContain('Checkout launch plan');
    expect(index).toContain(`path: ${result.pagePath}`);

    const page = await readMemoryPage(result.pagePath as string);
    expect(page.metadata.raw_refs).toHaveLength(1);
    expect(page.metadata.sources).toEqual(['notion']);
    expect(page.text).toContain('Refresh when');
    expect(page.text).toContain('Checkout launch is ready');

    await expect(readMemoryPage('raw/2026-05/run-1/01-notion.md')).rejects.toThrow(/not listed/);
  });

  it('indexes completed runs in the background worker idempotently', async () => {
    const root = tempPath('murph-memory-worker-');
    process.env.MURPH_MEMORY_PATH = join(root, 'memory');
    process.env.MURPH_SQLITE_PATH = join(root, 'murph.sqlite');

    const { getStore } = await import('../../src/lib/server/persistence/store');
    const { MemoryIndexWorker } = await import('../../src/lib/server/memory/index-worker');
    const store = getStore();
    const run = store.createAgentRun({
      workspaceId: 'workspace-1',
      taskId: 'task-1',
      channelId: 'C123',
      threadTs: '171642.000',
      targetUserId: 'U1'
    });
    store.appendAgentRunEvent({
      runId: run.id,
      type: 'agent.memory.index_source',
      payload: {
        artifacts: [{
          id: 'github:42',
          source: 'github',
          type: 'issue',
          title: 'Rate-limit blocker',
          text: 'The rate-limit blocker is closed.'
        }]
      }
    });
    store.finishAgentRun(run.id, 'completed');

    const worker = new MemoryIndexWorker();
    await worker.drain();

    expect(store.getMemoryIndexRun(run.id)).toEqual(expect.objectContaining({
      runId: run.id,
      status: 'indexed'
    }));
    const firstIndex = readFileSync(join(root, 'memory', 'index.md'), 'utf8');
    await worker.drain();
    expect(readFileSync(join(root, 'memory', 'index.md'), 'utf8')).toBe(firstIndex);
  });
});
