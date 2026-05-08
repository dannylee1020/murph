import { beforeEach, describe, expect, it, vi } from 'vitest';

function jsonResponse(): any & { result: () => { status: number; body: any } } {
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

vi.mock('#lib/server/runtime/bootstrap', () => ({
  ensureRuntimeInitialized: async () => {}
}));

describe('setup status route', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.SLACK_EVENTS_MODE = 'socket';
    process.env.SLACK_APP_TOKEN = 'xapp-test';
  });

  it('reports Slack Socket Mode readiness', async () => {
    const { systemRoutes } = await import('../../src/server/routes/system');
    const { dispatchRoute } = await import('../../src/server/router');
    const res = jsonResponse();

    await dispatchRoute(systemRoutes, {
      req: { method: 'GET', headers: {} } as any,
      res,
      url: new URL('/api/setup/status', 'http://localhost')
    });

    const result = res.result();
    expect(result.status).toBe(200);
    expect(result.body.slack).toMatchObject({
      eventsMode: 'socket',
      socketConfigured: true
    });
  });
});
