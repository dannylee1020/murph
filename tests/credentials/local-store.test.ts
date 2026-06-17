import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

async function loadStore() {
  vi.resetModules();
  process.env.MURPH_CREDENTIALS_PATH = join(mkdtempSync(join(tmpdir(), 'murph-credentials-store-')), '.credentials');
  return await import('#app/server/credentials/local-store');
}

describe('local credential store', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    delete process.env.MURPH_CREDENTIALS_PATH;
  });

  it('writes plaintext credentials with owner-only file permissions', async () => {
    const store = await loadStore();

    store.writeSecret('github', 'api_key', 'ghp_test', { workspaceId: 'W1', metadata: { account: 'octo' } });

    expect(store.readSecret('github', 'api_key', { workspaceId: 'W1' })).toBe('ghp_test');
    expect(store.readSecretRecord('github', 'api_key', { workspaceId: 'W1' })?.metadata).toEqual({ account: 'octo' });
    expect(existsSync(store.credentialsPath())).toBe(true);
    expect((statSync(store.credentialsPath()).mode & 0o777).toString(8)).toBe('600');
  });

  it('keeps global credentials distinct from workspace credentials', async () => {
    const store = await loadStore();

    store.writeSecret('github', 'api_key', 'global-token');
    store.writeSecret('github', 'api_key', 'workspace-token', { workspaceId: 'W1' });

    expect(store.readSecret('github', 'api_key')).toBe('global-token');
    expect(store.readSecret('github', 'api_key', { workspaceId: 'W1' })).toBe('workspace-token');
  });

  it('canonicalizes duplicate exact credential records on reconnect', async () => {
    const store = await loadStore();
    writeFileSync(store.credentialsPath(), JSON.stringify({
      version: 1,
      credentials: [
        {
          provider: 'notion',
          key: 'api_key',
          value: 'old-token',
          metadata: { masked: '****-old' },
          createdAt: '2026-06-01T00:00:00.000Z',
          updatedAt: '2026-06-01T00:00:00.000Z'
        },
        {
          provider: 'notion',
          key: 'api_key',
          value: 'newer-legacy-token',
          metadata: { masked: '****-legacy' },
          createdAt: '2026-06-02T00:00:00.000Z',
          updatedAt: '2026-06-02T00:00:00.000Z'
        }
      ]
    }));

    expect(store.readSecret('notion', 'api_key')).toBe('newer-legacy-token');

    store.writeSecret('notion', 'api_key', 'reconnected-token', {
      metadata: { masked: '****oken', workspaceName: 'Murph' }
    });

    const file = JSON.parse(readFileSync(store.credentialsPath(), 'utf8')) as {
      credentials: Array<{ provider: string; key: string; value: string; createdAt: string; metadata?: Record<string, unknown> }>;
    };
    const records = file.credentials.filter((record) => record.provider === 'notion' && record.key === 'api_key');
    expect(records).toHaveLength(1);
    expect(records[0]).toEqual(expect.objectContaining({
      value: 'reconnected-token',
      createdAt: '2026-06-01T00:00:00.000Z',
      metadata: { masked: '****oken', workspaceName: 'Murph' }
    }));
  });

  it('does not collapse scoped credentials when reconnecting a global credential', async () => {
    const store = await loadStore();

    store.writeSecret('github', 'api_key', 'global-token');
    store.writeSecret('github', 'api_key', 'workspace-token', { workspaceId: 'W1' });
    store.writeSecret('github', 'api_key', 'global-next', { metadata: { masked: '****next' } });

    const records = store.listSecrets().filter((record) => record.provider === 'github' && record.key === 'api_key');
    expect(records).toHaveLength(2);
    expect(store.readSecret('github', 'api_key')).toBe('global-next');
    expect(store.readSecret('github', 'api_key', { workspaceId: 'W1' })).toBe('workspace-token');
    expect(store.readSecretRecord('github', 'api_key')?.metadata).toEqual({ masked: '****next' });
  });
});
