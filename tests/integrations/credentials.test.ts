import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

async function setup(options: { githubPat?: string } = {}) {
  vi.resetModules();
  process.env.MURPH_SQLITE_PATH = join(mkdtempSync(join(tmpdir(), 'murph-credentials-')), 'murph.sqlite');
  process.env.MURPH_ENCRYPTION_KEY = 'test-key';
  process.env.GITHUB_PAT = options.githubPat ?? '';

  const { getStore } = await import('#lib/server/persistence/store');
  const { encryptString } = await import('#lib/server/util/crypto');
  const store = getStore();
  const workspace = store.saveInstall({
    slackTeamId: 'T1',
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

  it('prefers stored credentials over env fallback', async () => {
    const { store, workspace, encryptString } = await setup();
    process.env.GITHUB_PAT = 'env-token';
    store.saveIntegrationCredential({
      workspaceId: workspace.id,
      provider: 'github',
      credentialKind: 'api_key',
      credentialEncrypted: encryptString('stored-token', 'test-key'),
      metadata: { masked: '****oken' }
    });

    const { resolveCredential } = await import('#lib/server/integrations/credentials');
    expect(resolveCredential(workspace.id, 'github')).toEqual(
      expect.objectContaining({
        source: 'database',
        value: 'stored-token'
      })
    );
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
