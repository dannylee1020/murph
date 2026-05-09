import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

function tempMurphHome(): string {
  const home = mkdtempSync(join(tmpdir(), 'murph-adapters-'));
  mkdirSync(join(home, 'integrations'), { recursive: true });
  process.env.MURPH_HOME = home;
  return home;
}

function adapterModule(id: string): string {
  return `
export default {
  id: '${id}',
  name: '${id}',
  description: '${id} integration',
  credential: {
    authType: 'api_key',
    credentialKind: 'api_key',
    envKey: '${id.toUpperCase()}_API_KEY',
    credentialLabel: 'API key'
  },
  isConfigured() {
    return false;
  }
};
`;
}

describe('integration adapter loader', () => {
  beforeEach(() => {
    vi.resetModules();
    delete process.env.MURPH_HOME;
  });

  it('loads a direct adapter file', async () => {
    const home = tempMurphHome();
    writeFileSync(join(home, 'integrations', 'linear.js'), adapterModule('linear'));

    const { loadIntegrationAdapters } = await import('#lib/server/integrations/adapter-loader');
    const { listAdapters } = await import('#lib/server/integrations/adapter-registry');

    await loadIntegrationAdapters();

    expect(listAdapters().map((adapter) => adapter.id)).toContain('linear');
  });

  it('loads an adapter directory with index.js', async () => {
    const home = tempMurphHome();
    const dir = join(home, 'integrations', 'linear');
    mkdirSync(dir);
    writeFileSync(join(dir, 'index.js'), adapterModule('linear'));

    const { loadIntegrationAdapters } = await import('#lib/server/integrations/adapter-loader');
    const { listAdapters } = await import('#lib/server/integrations/adapter-registry');

    await loadIntegrationAdapters();

    expect(listAdapters().map((adapter) => adapter.id)).toContain('linear');
  });

  it('skips an adapter directory without an index file', async () => {
    const home = tempMurphHome();
    mkdirSync(join(home, 'integrations', 'empty'));

    const { loadIntegrationAdapters } = await import('#lib/server/integrations/adapter-loader');
    const { listAdapterStatuses } = await import('#lib/server/integrations/adapter-registry');

    await loadIntegrationAdapters();

    expect(listAdapterStatuses()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'empty',
          status: 'skipped',
          error: 'No index.js or index.mjs found'
        })
      ])
    );
  });

  it('records duplicate adapter IDs without overriding the first adapter', async () => {
    const home = tempMurphHome();
    writeFileSync(join(home, 'integrations', 'one.js'), adapterModule('linear'));
    writeFileSync(join(home, 'integrations', 'two.js'), adapterModule('linear'));

    const { loadIntegrationAdapters } = await import('#lib/server/integrations/adapter-loader');
    const { listAdapters, listAdapterStatuses } = await import('#lib/server/integrations/adapter-registry');

    await loadIntegrationAdapters();

    expect(listAdapters().filter((adapter) => adapter.id === 'linear')).toHaveLength(1);
    expect(listAdapterStatuses()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          status: 'failed',
          error: 'Integration adapter already registered: linear'
        })
      ])
    );
  });
});
