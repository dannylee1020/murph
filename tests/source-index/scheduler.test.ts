import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

async function setup() {
  vi.resetModules();
  const root = mkdtempSync(join(tmpdir(), 'murph-source-index-scheduler-'));
  process.env.MURPH_MEMORY_PATH = join(root, 'memory');
  process.env.MURPH_SQLITE_PATH = join(root, 'murph.sqlite');
  process.env.MURPH_ENCRYPTION_KEY = 'test-key';
  process.env.MURPH_DISTRIBUTION = 'team';
  process.env.MURPH_SOURCE_INDEX_INTERVAL_MS = String(24 * 60 * 60 * 1000);
  process.env.MURPH_SOURCE_INDEX_RETRY_INTERVAL_MS = String(60 * 60 * 1000);
  delete process.env.GITHUB_PAT;
  delete process.env.NOTION_API_KEY;
  delete process.env.LINEAR_API_KEY;

  const { getStore } = await import('../../app/server/persistence/store');
  const store = getStore();
  const workspace = store.saveInstall({
    provider: 'slack',
    externalWorkspaceId: 'T1',
    name: 'Test Workspace',
    botUserId: 'UTZBOT'
  });
  return { store, workspace };
}

describe('SourceIndexScheduler', () => {
  beforeEach(() => {
    vi.resetModules();
    delete process.env.MURPH_MEMORY_PATH;
    delete process.env.MURPH_SQLITE_PATH;
    delete process.env.MURPH_ENCRYPTION_KEY;
    delete process.env.MURPH_DISTRIBUTION;
    delete process.env.MURPH_SOURCE_INDEX_ENABLED;
    delete process.env.MURPH_SOURCE_INDEX_INTERVAL_MS;
    delete process.env.MURPH_SOURCE_INDEX_RETRY_INTERVAL_MS;
    delete process.env.GITHUB_PAT;
    delete process.env.NOTION_API_KEY;
    delete process.env.LINEAR_API_KEY;
  });

  it('runs missing team providers on startup tick', async () => {
    const { store, workspace } = await setup();
    const { SourceIndexScheduler } = await import('../../app/server/source-index/scheduler');

    const result = await new SourceIndexScheduler().tick('startup', new Date('2026-06-02T20:00:00Z'));

    expect(result).toHaveLength(1);
    expect(result[0].runs.map((run) => run.provider)).toEqual(['github', 'notion', 'linear']);
    expect(store.listSourceIndexRuns({ workspaceId: workspace.id }).map((run) => run.provider))
      .toEqual(expect.arrayContaining(['github', 'notion', 'linear']));
  });

  it('skips fresh providers until the source index interval passes', async () => {
    const { workspace } = await setup();
    const { SourceIndexScheduler } = await import('../../app/server/source-index/scheduler');
    const scheduler = new SourceIndexScheduler();

    await scheduler.tick('startup', new Date('2026-06-02T20:00:00Z'));
    const result = await scheduler.tick('heartbeat', new Date('2026-06-02T20:30:00Z'));

    expect(result).toEqual([]);
    expect(scheduler.status(workspace.id, new Date('2026-06-02T20:30:00Z')).workspaces[0].providers)
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ provider: 'github', status: 'fresh' })
      ]));
  });

  it('does not run when source indexing is disabled', async () => {
    const { store, workspace } = await setup();
    process.env.MURPH_SOURCE_INDEX_ENABLED = 'false';
    const { resetRuntimeEnvCache } = await import('../../app/server/util/env');
    resetRuntimeEnvCache();
    const { SourceIndexScheduler } = await import('../../app/server/source-index/scheduler');

    const result = await new SourceIndexScheduler().tick('heartbeat', new Date('2026-06-02T20:00:00Z'));

    expect(result).toEqual([]);
    expect(store.listSourceIndexRuns({ workspaceId: workspace.id })).toEqual([]);
  });
});
