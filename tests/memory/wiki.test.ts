import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

function tempPath(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

async function setup() {
  vi.resetModules();
  const root = tempPath('murph-memory-analytics-');
  process.env.MURPH_MEMORY_PATH = join(root, 'memory');
  process.env.MURPH_SQLITE_PATH = join(root, 'murph.sqlite');
  process.env.MURPH_ENCRYPTION_KEY = 'test-key';

  const { getStore } = await import('../../shared/server/persistence/store');
  const store = getStore();
  const workspace = store.saveInstall({
    provider: 'slack',
    externalWorkspaceId: 'T1',
    name: 'Test Workspace',
    botUserId: 'UTZBOT'
  });
  const session = store.createSession({
    workspaceId: workspace.id,
    ownerUserId: 'UOWNER',
    title: 'Launch coverage',
    mode: 'manual_review',
    channelScope: ['C123'],
    endsAt: '2026-05-24T19:00:00.000Z'
  });
  return { root, store, workspace, session };
}

function appendRunEvents(store: Awaited<ReturnType<typeof setup>>['store'], runId: string, requestText: string) {
  store.appendAgentRunEvent({
    runId,
    type: 'agent.run.started',
    payload: {
      task: {
        triggerMessage: {
          text: requestText
        }
      }
    }
  });
  store.appendAgentRunEvent({
    runId,
    type: 'agent.context.built',
    payload: {
      summary: 'Release readiness depends on the review trail.'
    }
  });
  store.appendAgentRunEvent({
    runId,
    type: 'agent.tool.completed',
    payload: {
      id: 'tool-1',
      name: 'github.search',
      ok: true,
      outputSummary: { title: 'Review trail issue' }
    }
  });
  store.appendAgentRunEvent({
    runId,
    type: 'agent.memory.index_source',
    payload: {
      artifacts: [{
        id: 'github:42',
        source: 'github',
        type: 'issue',
        title: 'Review trail issue',
        text: 'The review trail still needs polish.',
        url: 'https://github.test/repo/issues/42'
      }],
      toolResults: [{
        id: 'tool-1',
        name: 'github.search',
        ok: true,
        output: { results: [{ title: 'Review trail issue' }] }
      }]
    }
  });
  store.appendAgentRunEvent({
    runId,
    type: 'agent.policy.decided',
    payload: {
      reason: 'Manual review mode queues actions by default.'
    }
  });
  store.appendAgentRunEvent({
    runId,
    type: 'agent.action.queued',
    payload: {
      itemId: 'review-1',
      action: 'reply'
    }
  });
  store.appendAgentRunEvent({
    runId,
    type: 'agent.run.completed',
    payload: {
      executionResult: 'Queued for operator review.'
    }
  });
}

describe('markdown OLAP memory', () => {
  beforeEach(() => {
    vi.resetModules();
    delete process.env.MURPH_MEMORY_PATH;
    delete process.env.MURPH_SQLITE_PATH;
  });

  it('builds indexed session and thread pages from SQLite run history', async () => {
    const { root, store, workspace, session } = await setup();
    const run = store.createAgentRun({
      workspaceId: workspace.id,
      sessionId: session.id,
      taskId: 'task-1',
      channelId: 'C123',
      threadTs: '171642.000',
      targetUserId: 'UOWNER'
    });
    appendRunEvents(store, run.id, 'What is blocking launch?');
    store.finishAgentRun(run.id, 'completed');

    const { rebuildMemoryPagesForRun, readMemoryIndex, readMemoryPage } = await import('../../shared/server/memory/wiki');
    const result = await rebuildMemoryPagesForRun(store.getAgentRun(run.id)!);

    expect(result.pagePaths).toEqual([
      `threads/${workspace.id}/c123-171642.000.md`,
      `sessions/${session.id}.md`
    ]);
    const index = await readMemoryIndex();
    expect(index).toContain(`path: threads/${workspace.id}/c123-171642.000.md`);
    expect(index).toContain(`path: sessions/${session.id}.md`);

    const threadPage = await readMemoryPage(`threads/${workspace.id}/c123-171642.000.md`);
    expect(threadPage.metadata.page_type).toBe('thread');
    expect(threadPage.text).toContain('What is blocking launch?');
    expect(threadPage.text).toContain('github.search');
    expect(threadPage.text).toContain('Review trail issue');
    expect(threadPage.text).toContain(run.id);

    const sessionPage = await readMemoryPage(`sessions/${session.id}.md`);
    expect(sessionPage.metadata.page_type).toBe('session');
    expect(sessionPage.text).toContain('Launch coverage');
    expect(sessionPage.text).toContain('Queued for operator review.');
  });

  it('updates one thread page across repeated runs and rejects deprecated paths', async () => {
    const { store, workspace, session } = await setup();
    const { rebuildMemoryPagesForRun, readMemoryPage } = await import('../../shared/server/memory/wiki');

    const first = store.createAgentRun({
      workspaceId: workspace.id,
      sessionId: session.id,
      taskId: 'task-1',
      channelId: 'C123',
      threadTs: '171642.000',
      targetUserId: 'UOWNER'
    });
    appendRunEvents(store, first.id, 'What is blocking launch?');
    store.finishAgentRun(first.id, 'completed');
    await rebuildMemoryPagesForRun(store.getAgentRun(first.id)!);

    const second = store.createAgentRun({
      workspaceId: workspace.id,
      sessionId: session.id,
      taskId: 'task-2',
      channelId: 'C123',
      threadTs: '171642.000',
      targetUserId: 'UOWNER'
    });
    appendRunEvents(store, second.id, 'Did review trail get fixed?');
    store.finishAgentRun(second.id, 'completed');
    await rebuildMemoryPagesForRun(store.getAgentRun(second.id)!);

    const page = await readMemoryPage(`threads/${workspace.id}/c123-171642.000.md`);
    expect(page.text).toContain(first.id);
    expect(page.text).toContain(second.id);
    expect(page.text).toContain('Did review trail get fixed?');
    await expect(readMemoryPage('raw/2026-05/run-1/01-github.md')).rejects.toThrow(/not listed/);
    await expect(readMemoryPage('wiki/threads/workspace-1/c123.md')).rejects.toThrow(/not listed/);
  });

  it('indexes completed runs in the background worker and removes deprecated generated folders', async () => {
    const { root, store, workspace } = await setup();
    mkdirSync(join(root, 'memory', 'raw', '2026-05'), { recursive: true });
    writeFileSync(join(root, 'memory', 'raw', '2026-05', 'old.md'), 'old');
    mkdirSync(join(root, 'memory', 'workspaces', 'old'), { recursive: true });
    writeFileSync(join(root, 'memory', 'workspaces', 'old', 'thread.md'), 'old');
    mkdirSync(join(root, 'memory', 'wiki', 'old'), { recursive: true });
    writeFileSync(join(root, 'memory', 'wiki', 'old', 'page.md'), 'old');
    writeFileSync(join(root, 'memory', 'log.md'), 'old');

    const { MemoryIndexWorker } = await import('../../shared/server/memory/index-worker');
    const run = store.createAgentRun({
      workspaceId: workspace.id,
      taskId: 'task-1',
      channelId: 'C123',
      threadTs: '171642.000',
      targetUserId: 'UOWNER'
    });
    appendRunEvents(store, run.id, 'What is blocking launch?');
    store.finishAgentRun(run.id, 'completed');

    const worker = new MemoryIndexWorker();
    await worker.drain();

    expect(store.getMemoryIndexRun(run.id)).toEqual(expect.objectContaining({
      runId: run.id,
      status: 'indexed'
    }));
    expect(readFileSync(join(root, 'memory', 'index.md'), 'utf8')).toContain('threads/');
    expect(existsSync(join(root, 'memory', 'raw'))).toBe(false);
    expect(existsSync(join(root, 'memory', 'workspaces'))).toBe(false);
    expect(existsSync(join(root, 'memory', 'wiki'))).toBe(false);
    expect(existsSync(join(root, 'memory', 'log.md'))).toBe(false);
  });
});
