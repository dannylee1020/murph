import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

function tempRoot(): string {
  return mkdtempSync(join(tmpdir(), 'murph-source-index-worker-'));
}

async function setup() {
  vi.resetModules();
  const root = tempRoot();
  const vault = join(root, 'vault');
  mkdirSync(vault, { recursive: true });
  writeFileSync(join(vault, 'Checkout Launch.md'), [
    '# Checkout Launch',
    '',
    'Payment callback verification is the current launch blocker.'
  ].join('\n'));

  process.env.MURPH_MEMORY_PATH = join(root, 'memory');
  process.env.MURPH_SQLITE_PATH = join(root, 'murph.sqlite');
  process.env.MURPH_ENCRYPTION_KEY = 'test-key';
  process.env.OBSIDIAN_VAULT_PATH = vault;
  delete process.env.GITHUB_PAT;
  delete process.env.NOTION_API_KEY;
  delete process.env.LINEAR_API_KEY;
  delete process.env.GRANOLA_API_KEY;

  const { getStore } = await import('../../app/server/persistence/store');
  const store = getStore();
  const workspace = store.saveInstall({
    provider: 'slack',
    externalWorkspaceId: 'T1',
    name: 'Test Workspace',
    botUserId: 'UTZBOT'
  });
  return { root, vault, store, workspace };
}

describe('SourceIndexWorker', () => {
  beforeEach(() => {
    vi.resetModules();
    delete process.env.MURPH_MEMORY_PATH;
    delete process.env.MURPH_SQLITE_PATH;
    delete process.env.MURPH_ENCRYPTION_KEY;
    delete process.env.MURPH_DISTRIBUTION;
    delete process.env.OBSIDIAN_VAULT_PATH;
    delete process.env.GITHUB_PAT;
    delete process.env.NOTION_API_KEY;
    delete process.env.LINEAR_API_KEY;
    delete process.env.GRANOLA_API_KEY;
  });

  it('refreshes markdown resources and stores only run observability in SQLite', async () => {
    const { root, store, workspace } = await setup();
    const { getDb } = await import('../../app/server/persistence/db');
    const { SourceIndexWorker } = await import('../../app/server/source-index/worker');

    const result = await new SourceIndexWorker().refresh(workspace.id);

    expect(result.runs).toEqual(expect.arrayContaining([
      expect.objectContaining({ provider: 'github', status: 'skipped', resourceCount: 0 }),
      expect.objectContaining({ provider: 'notion', status: 'skipped', resourceCount: 0 }),
      expect.objectContaining({ provider: 'linear', status: 'skipped', resourceCount: 0 })
    ]));
    const runs = store.listSourceIndexRuns({ workspaceId: workspace.id });
    expect(runs.map((run) => run.provider)).toEqual(expect.arrayContaining(['github', 'notion', 'linear']));
    expect(runs.map((run) => run.provider)).not.toEqual(expect.arrayContaining(['obsidian', 'granola']));

    const columns = (getDb().prepare(`PRAGMA table_info(source_index_runs)`).all() as Array<{ name: string }>)
      .map((column) => column.name);
    expect(columns).not.toEqual(expect.arrayContaining(['title', 'external_id', 'metadata_json', 'content', 'summary']));

    const sourceIndexPath = join(root, 'memory', 'source-index', 'index.md');
    expect(existsSync(sourceIndexPath)).toBe(true);
    expect(readFileSync(sourceIndexPath, 'utf8')).toContain('routing metadata only');
  });
});
