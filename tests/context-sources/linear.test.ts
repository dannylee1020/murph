import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

async function setup() {
  vi.resetModules();
  const root = mkdtempSync(join(tmpdir(), 'murph-linear-service-'));
  process.env.MURPH_SQLITE_PATH = join(root, 'murph.sqlite');
  process.env.MURPH_CONFIG_PATH = join(root, 'config.yaml');
  process.env.MURPH_CREDENTIALS_PATH = join(root, '.credentials');
  process.env.MURPH_ENCRYPTION_KEY = 'test-key';
  process.env.LINEAR_API_KEY = '';

  const { getStore } = await import('#shared/server/persistence/store');
  const store = getStore();
  const workspace = store.saveInstall({
    provider: 'slack',
    externalWorkspaceId: 'T1',
    name: 'Test Workspace',
    botUserId: 'UTZBOT'
  });
  const { writeSecret } = await import('#shared/server/credentials/local-store');
  writeSecret('linear', 'api_key', 'lin_api_key');

  return { workspace };
}

describe('LinearService', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    process.env.LINEAR_API_KEY = '';
  });

  it('uses the raw Linear API key in the Authorization header', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          issues: {
            nodes: [
              {
                id: 'issue-1',
                identifier: 'MUR-1',
                title: 'Fix Linear auth',
                description: 'Use raw API key',
                url: 'https://linear.app/murph/issue/MUR-1',
                updatedAt: '2026-06-01T19:00:00.000Z'
              }
            ]
          }
        }
      })
    });
    vi.stubGlobal('fetch', fetchMock);
    const { workspace } = await setup();
    const { getLinearService } = await import('#shared/server/context-sources/linear');

    const result = await getLinearService().searchIssues('auth', 5, workspace.id);

    expect(result.results[0]).toEqual(expect.objectContaining({
      identifier: 'MUR-1',
      title: 'Fix Linear auth'
    }));
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.linear.app/graphql',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'lin_api_key'
        })
      })
    );
  });
});
