import { Readable } from 'node:stream';
import { mkdirSync, writeFileSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('#lib/server/runtime/bootstrap', () => ({
  ensureRuntimeInitialized: vi.fn().mockResolvedValue(undefined)
}));

type JsonResponse = {
  status: number;
  body: any;
};

function jsonRequest(method: string): any {
  const req = Readable.from([]) as any;
  req.method = method;
  req.headers = {};
  return req;
}

function jsonResponse(): any & { result: () => JsonResponse } {
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

function tempMurphHome(): string {
  const home = mkdtempSync(join(tmpdir(), 'murph-plugin-routes-'));
  mkdirSync(join(home, 'plugins', 'linear', 'skills'), { recursive: true });
  process.env.MURPH_HOME = home;

  const root = join(home, 'plugins', 'linear');
  writeFileSync(join(root, 'plugin.json'), JSON.stringify({
    id: 'linear',
    name: 'Linear',
    description: 'Linear plugin',
    capabilities: {
      skills: ['skills/linear.md']
    }
  }));
  writeFileSync(join(root, 'skills', 'linear.md'), [
    '---',
    'name: linear',
    'description: Linear skill',
    '---',
    'Use Linear context.'
  ].join('\n'));
  return home;
}

async function setup() {
  vi.resetModules();
  tempMurphHome();
  const { pluginRoutes } = await import('../../src/server/routes/plugins');
  const { dispatchRoute } = await import('../../src/server/router');

  async function request(method: string, path: string) {
    const req = jsonRequest(method);
    const res = jsonResponse();
    await dispatchRoute(pluginRoutes, {
      req,
      res,
      url: new URL(path, 'http://localhost')
    });
    return res.result();
  }

  return { request };
}

describe('plugin routes', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    delete process.env.MURPH_HOME;
  });

  it('reloads scoped plugins and reports status', async () => {
    const { request } = await setup();

    const reload = await request('POST', '/api/plugins/reload');
    expect(reload.status).toBe(200);
    expect(reload.body.plugins).toEqual([
      expect.objectContaining({ id: 'linear', status: 'loaded' })
    ]);

    const status = await request('GET', '/api/plugins/status');
    expect(status.status).toBe(200);
    expect(status.body.plugins).toEqual([
      expect.objectContaining({ id: 'linear', status: 'loaded' })
    ]);
  });
});
