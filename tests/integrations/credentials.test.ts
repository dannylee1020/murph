import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

async function setup(options: { githubPat?: string } = {}) {
  vi.resetModules();
  const root = mkdtempSync(join(tmpdir(), 'murph-credentials-'));
  process.env.MURPH_SQLITE_PATH = join(root, 'murph.sqlite');
  process.env.MURPH_CREDENTIALS_PATH = join(root, '.credentials');
  process.env.MURPH_ENCRYPTION_KEY = 'test-key';
  process.env.GITHUB_PAT = options.githubPat ?? '';

  const { getStore } = await import('#lib/server/persistence/store');
  const { encryptString } = await import('#lib/server/util/crypto');
  const store = getStore();
  const workspace = store.saveInstall({
    provider: 'slack',
    externalWorkspaceId: 'T1',
    name: 'Test Workspace',
    botTokenEncrypted: 'token',
    botUserId: 'UTZBOT'
  });

  return { store, workspace, encryptString };
}

describe('integration credential resolution', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    delete process.env.GITHUB_PAT;
  });

  it('prefers process env credentials over local store fallback', async () => {
    const { workspace } = await setup();
    process.env.GITHUB_PAT = 'env-token';
    const { writeSecret } = await import('#lib/server/credentials/local-store');
    writeSecret('github', 'api_key', 'stored-token', { workspaceId: workspace.id });

    const { resolveCredential } = await import('#lib/server/integrations/credentials');
    expect(resolveCredential(workspace.id, 'github')).toEqual(
      expect.objectContaining({
        source: 'env',
        value: 'env-token'
      })
    );
  });

  it('reads local store credentials and ignores legacy database credentials', async () => {
    const { store, workspace, encryptString } = await setup();
    const { writeSecret } = await import('#lib/server/credentials/local-store');
    writeSecret('github', 'api_key', 'stored-token', { workspaceId: workspace.id, metadata: { masked: '****oken' } });
    store.saveIntegrationCredential({
      workspaceId: workspace.id,
      provider: 'github',
      credentialKind: 'api_key',
      credentialEncrypted: encryptString('legacy-token', 'test-key'),
      metadata: { masked: '****gacy' }
    });

    const { resolveCredential } = await import('#lib/server/integrations/credentials');
    expect(resolveCredential(workspace.id, 'github')).toEqual(
      expect.objectContaining({
        source: 'credentials',
        value: 'stored-token'
      })
    );
  });

  it('does not resolve legacy database-only credentials at runtime', async () => {
    const { store, workspace, encryptString } = await setup();
    store.saveIntegrationCredential({
      workspaceId: workspace.id,
      provider: 'github',
      credentialKind: 'api_key',
      credentialEncrypted: encryptString('legacy-token', 'test-key'),
      metadata: { masked: '****gacy' }
    });

    const { resolveCredential } = await import('#lib/server/integrations/credentials');
    expect(resolveCredential(workspace.id, 'github')).toBeUndefined();
  });

  it('falls back to env credentials when none are stored', async () => {
    const { workspace } = await setup({ githubPat: 'env-token' });

    const { resolveCredential } = await import('#lib/server/integrations/credentials');
    expect(resolveCredential(workspace.id, 'github')).toEqual({
      source: 'env',
      value: 'env-token'
    });
  });
});
