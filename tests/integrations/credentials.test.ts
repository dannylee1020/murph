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

  const { getStore } = await import('#shared/server/persistence/store');
  const store = getStore();
  const workspace = store.saveInstall({
    provider: 'slack',
    externalWorkspaceId: 'T1',
    name: 'Test Workspace',
    botUserId: 'UTZBOT'
  });

  return { store, workspace };
}

describe('integration credential resolution', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    delete process.env.GITHUB_PAT;
  });

  it('prefers global local store credentials over process env fallback', async () => {
    const { workspace } = await setup();
    process.env.GITHUB_PAT = 'env-token';
    const { writeSecret } = await import('#shared/server/credentials/local-store');
    writeSecret('github', 'api_key', 'stored-token');

    const { resolveCredential } = await import('#shared/server/integrations/credentials');
    expect(resolveCredential(workspace.id, 'github')).toEqual(
      expect.objectContaining({
        source: 'credentials',
        value: 'stored-token'
      })
    );
  });

  it('reads local store credentials and ignores connection metadata', async () => {
    const { store, workspace } = await setup();
    const { writeSecret } = await import('#shared/server/credentials/local-store');
    writeSecret('github', 'api_key', 'stored-token', { metadata: { masked: '****oken' } });
    store.saveIntegrationConnection({
      workspaceId: workspace.id,
      provider: 'github',
      credentialKind: 'api_key',
      metadata: { masked: '****data' }
    });

    const { resolveCredential } = await import('#shared/server/integrations/credentials');
    expect(resolveCredential(workspace.id, 'github')).toEqual(
      expect.objectContaining({
        source: 'credentials',
        value: 'stored-token'
      })
    );
  });

  it('does not resolve connection metadata as a credential', async () => {
    const { store, workspace } = await setup();
    store.saveIntegrationConnection({
      workspaceId: workspace.id,
      provider: 'github',
      credentialKind: 'api_key',
      metadata: { masked: '****data' }
    });

    const { resolveCredential } = await import('#shared/server/integrations/credentials');
    expect(resolveCredential(workspace.id, 'github')).toBeUndefined();
  });

  it('falls back to env credentials when none are stored', async () => {
    const { workspace } = await setup({ githubPat: 'env-token' });

    const { resolveCredential } = await import('#shared/server/integrations/credentials');
    expect(resolveCredential(workspace.id, 'github')).toEqual({
      source: 'env',
      value: 'env-token'
    });
  });

  it('ignores legacy workspace-scoped credentials', async () => {
    const { workspace } = await setup();
    const { writeSecret } = await import('#shared/server/credentials/local-store');
    writeSecret('github', 'api_key', 'scoped-token', { workspaceId: workspace.id });

    const { resolveCredential } = await import('#shared/server/integrations/credentials');
    expect(resolveCredential(workspace.id, 'github')).toBeUndefined();
  });
});
