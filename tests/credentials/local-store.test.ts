import { existsSync, statSync } from 'node:fs';
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
});
