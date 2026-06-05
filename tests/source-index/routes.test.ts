import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { beforeEach, describe, expect, it, vi } from 'vitest';

function request(method: string): any {
  const req = Readable.from([]) as any;
  req.method = method;
  req.headers = {};
  return req;
}

function response(): any & { result: () => { status: number; body: any } } {
  let status = 200;
  let payload = '';
  return {
    writeHead(nextStatus: number) {
      status = nextStatus;
    },
    end(nextPayload: string) {
      payload = nextPayload;
    },
    result() {
      return { status, body: JSON.parse(payload) };
    }
  };
}

async function setup() {
  vi.resetModules();
  const root = mkdtempSync(join(tmpdir(), 'murph-source-index-routes-'));
  process.env.MURPH_MEMORY_PATH = join(root, 'memory');
  process.env.MURPH_SQLITE_PATH = join(root, 'murph.sqlite');
  process.env.MURPH_ENCRYPTION_KEY = 'test-key';
  process.env.MURPH_DISTRIBUTION = 'team';
  delete process.env.OBSIDIAN_VAULT_PATH;
  delete process.env.GITHUB_PAT;
  delete process.env.NOTION_API_KEY;
  delete process.env.LINEAR_API_KEY;

  const { dispatchRoute } = await import('../../app/server/router');
  const { sourceIndexRoutes } = await import('../../app/server/routes/source-index');
  const { getStore } = await import('../../app/server/persistence/store');
  const workspace = getStore().saveInstall({
    provider: 'slack',
    externalWorkspaceId: 'T1',
    name: 'Test Workspace',
    botUserId: 'UTZBOT'
  });
  return { dispatchRoute, sourceIndexRoutes, workspace };
}

describe('source index routes', () => {
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
  });

  it('reports status and refreshes without exposing source content', async () => {
    const { dispatchRoute, sourceIndexRoutes, workspace } = await setup();

    const refreshRes = response();
    await dispatchRoute(sourceIndexRoutes, {
      req: request('POST'),
      res: refreshRes,
      url: new URL(`http://localhost/api/source-index/refresh?workspaceId=${workspace.id}`)
    });
    expect(refreshRes.result()).toEqual({
      status: 200,
      body: expect.objectContaining({
        ok: true,
        workspaceId: workspace.id,
        runs: expect.arrayContaining([
          expect.objectContaining({ provider: 'github', status: 'skipped' }),
          expect.objectContaining({ provider: 'notion', status: 'skipped' }),
          expect.objectContaining({ provider: 'linear', status: 'skipped' })
        ])
      })
    });

    const statusRes = response();
    await dispatchRoute(sourceIndexRoutes, {
      req: request('GET'),
      res: statusRes,
      url: new URL(`http://localhost/api/source-index/status?workspaceId=${workspace.id}`)
    });
    const status = statusRes.result();
    expect(status.status).toBe(200);
    expect(status.body).toEqual(expect.objectContaining({
      ok: true,
      workspaceId: workspace.id,
      scheduler: expect.objectContaining({
        distribution: 'team',
        enabled: true
      }),
      runs: expect.arrayContaining([
        expect.objectContaining({ provider: 'github' }),
        expect.objectContaining({ provider: 'notion' }),
        expect.objectContaining({ provider: 'linear' })
      ])
    }));
    expect(JSON.stringify(status.body)).not.toMatch(/Payment callback|source body|GITHUB_PAT|OBSIDIAN/);
  });

  it('rejects explicitly unsupported source index providers', async () => {
    const { dispatchRoute, sourceIndexRoutes, workspace } = await setup();
    const req = Readable.from([JSON.stringify({ providers: ['google'] })]) as any;
    req.method = 'POST';
    req.headers = {};
    const res = response();

    await dispatchRoute(sourceIndexRoutes, {
      req,
      res,
      url: new URL(`http://localhost/api/source-index/refresh?workspaceId=${workspace.id}`)
    });

    expect(res.result()).toEqual({
      status: 400,
      body: expect.objectContaining({
        ok: false,
        error: expect.stringContaining('Unsupported source index provider')
      })
    });
  });
});
