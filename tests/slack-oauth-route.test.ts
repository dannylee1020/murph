import { Readable } from 'node:stream';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const ensureStarted = vi.fn();

function request(): any {
  const req = Readable.from([]) as any;
  req.method = 'GET';
  req.headers = { host: 'localhost:5173' };
  return req;
}

function response(): any & { result: () => { status: number; headers: Record<string, string> } } {
  let status = 200;
  let headers: Record<string, string> = {};
  return {
    writeHead(nextStatus: number, nextHeaders: Record<string, string>) {
      status = nextStatus;
      headers = nextHeaders;
    },
    end() {},
    result() {
      return { status, headers };
    }
  };
}

async function setup(
  slackPayload: Record<string, unknown>,
  options: { userInfoPayload?: Record<string, unknown>; configYaml?: string } = {}
) {
  vi.resetModules();
  ensureStarted.mockReset();
  const root = mkdtempSync(path.join(tmpdir(), 'murph-slack-oauth-route-'));
  process.env.MURPH_CONFIG_PATH = path.join(root, 'config.yaml');
  process.env.MURPH_SQLITE_PATH = path.join(root, 'murph.sqlite');
  process.env.MURPH_CREDENTIALS_PATH = path.join(root, '.credentials');
  process.env.MURPH_ENCRYPTION_KEY = 'test-key';
  process.env.SLACK_CLIENT_ID = 'client-id';
  process.env.SLACK_CLIENT_SECRET = 'client-secret';
  process.env.OPENAI_API_KEY = 'sk-test';
  if (options.configYaml) {
    writeFileSync(process.env.MURPH_CONFIG_PATH, options.configYaml);
  }

  vi.stubGlobal('fetch', vi.fn(async (url) => {
    if (String(url).includes('/users.info')) {
      return Response.json(options.userInfoPayload ?? { ok: false, error: 'not_found' });
    }
    return Response.json(slackPayload);
  }));
  vi.doMock('#shared/server/channels/slack/socket-client', () => ({
    getSlackSocketModeClient: (role: 'channel' | 'personal' = 'channel') => ({
      isConfigured: () => role === 'channel',
      ensureStarted
    })
  }));
  vi.doMock('#shared/server/runtime/bootstrap', () => ({
    ensureRuntimeInitialized: vi.fn().mockResolvedValue(undefined)
  }));
  vi.doMock('#shared/server/capabilities/channel-registry', () => ({
    getChannelRegistry: () => ({
      getIngress: () => ({ start: ensureStarted })
    })
  }));

  const { slackRoutes } = await import('../shared/server/routes/slack');
  const { dispatchRoute } = await import('../shared/server/router');
  const { getStore } = await import('#shared/server/persistence/store');

  async function get(pathname: string) {
    const res = response();
    await dispatchRoute(slackRoutes, {
      req: request(),
      res,
      url: new URL(pathname, 'http://localhost:5173')
    });
    return res.result();
  }

  return { get, root, store: getStore() };
}

describe('Slack OAuth callback route', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    delete process.env.MURPH_CONFIG_PATH;
    delete process.env.MURPH_SQLITE_PATH;
    delete process.env.MURPH_CREDENTIALS_PATH;
    delete process.env.MURPH_ENCRYPTION_KEY;
    delete process.env.SLACK_CLIENT_ID;
    delete process.env.SLACK_CLIENT_SECRET;
    delete process.env.SLACK_PERSONAL_CLIENT_ID;
    delete process.env.SLACK_PERSONAL_CLIENT_SECRET;
    delete process.env.OPENAI_API_KEY;
  });

  it('starts Socket Mode and uses the Slack OAuth user as setup owner', async () => {
    const { get, store } = await setup({
      ok: true,
      team: { id: 'T1', name: 'Murph Test' },
      access_token: 'xoxb-test',
      bot_user_id: 'UTZBOT',
      authed_user: { id: 'U1', access_token: 'xoxp-test' }
    }, {
      userInfoPayload: {
        ok: true,
        user: {
          id: 'U1',
          profile: { display_name: 'Daniel' }
        }
      }
    });

    const result = await get('/api/slack/oauth/callback?code=abc');

    expect(result.status).toBe(302);
    expect(store.getAppSettings().setupDefaults).toMatchObject({
      ownerUserId: 'U1',
      ownerDisplayName: 'Daniel',
      workspaceOwners: [
        expect.objectContaining({
          ownerUserId: 'U1',
          ownerDisplayName: 'Daniel'
        })
      ]
    });
    const workspace = store.getWorkspaceByExternalId('slack', 'T1');
    expect(workspace && store.getUser(workspace.id, 'U1')?.displayName).toBe('Daniel');
    expect(workspace && store.getProviderSettings(workspace.id)).toBeUndefined();
  });

  it('preserves an existing setup owner while saving the Slack workspace owner on reconnect', async () => {
    const { get, store } = await setup({
      ok: true,
      team: { id: 'T1', name: 'Murph Test' },
      access_token: 'xoxb-test',
      bot_user_id: 'UTZBOT',
      authed_user: { id: 'U1', access_token: 'xoxp-test' }
    }, {
      userInfoPayload: {
        ok: true,
        user: {
          id: 'U1',
          profile: { display_name: 'Daniel' }
        }
      }
    });
    store.upsertAppSettings({
      setupDefaults: {
        ownerUserId: 'UEXISTING',
        ownerDisplayName: 'Existing Owner'
      }
    });

    const result = await get('/api/slack/oauth/callback?code=abc');

    expect(result.status).toBe(302);
    expect(store.getAppSettings().setupDefaults).toMatchObject({
      ownerUserId: 'UEXISTING',
      ownerDisplayName: 'Existing Owner',
      workspaceOwners: [
        expect.objectContaining({
          ownerUserId: 'U1',
          ownerDisplayName: 'Daniel'
        })
      ]
    });
  });

  it('returns CLI-sourced workspace installs to the terminal completion page', async () => {
    const { get } = await setup({
      ok: true,
      team: { id: 'T1', name: 'Murph Test' },
      access_token: 'xoxb-test',
      bot_user_id: 'UTZBOT'
    });

    const result = await get('/api/slack/oauth/callback?code=abc&state=cli');

    expect(result.status).toBe(302);
    expect(result.headers.location).toBe('/oauth/cli-complete?provider=slack&role=channel&status=success');
    expect(ensureStarted).toHaveBeenCalledOnce();
  });

  it('returns CLI-sourced Slack failures to the terminal completion page', async () => {
    const { get } = await setup({ ok: false, error: 'account_inactive' });

    const result = await get('/api/slack/oauth/callback?code=abc&state=cli');

    expect(result.status).toBe(302);
    expect(result.headers.location).toBe('/oauth/cli-complete?provider=slack&role=channel&status=error&reason=account_inactive');
    expect(ensureStarted).not.toHaveBeenCalled();
  });

  it('returns setup-sourced Slack installs to the setup wizard', async () => {
    const { get } = await setup({
      ok: true,
      team: { id: 'T1', name: 'Murph Test' },
      access_token: 'xoxb-test',
      bot_user_id: 'UTZBOT'
    });

    const result = await get('/api/slack/oauth/callback?code=abc&state=setup');

    expect(result.status).toBe(302);
    expect(result.headers.location).toBe('/setup?step=slack&role=channel&success=1');
  });

  it('returns personal CLI installs to the terminal completion page with role context', async () => {
    process.env.SLACK_PERSONAL_CLIENT_ID = 'personal-client-id';
    process.env.SLACK_PERSONAL_CLIENT_SECRET = 'personal-client-secret';
    const { get, store } = await setup({
      ok: true,
      team: { id: 'T1', name: 'Murph Test' },
      access_token: 'xoxb-test',
      bot_user_id: 'UTZBOT',
      authed_user: { id: 'U1' }
    });

    const result = await get('/api/slack/oauth/callback?code=abc&state=personal:cli');

    expect(result.status).toBe(302);
    expect(result.headers.location).toBe('/oauth/cli-complete?provider=slack&role=personal&status=success');
    const install = store.getBotInstallation('slack', 'T1', 'personal');
    const { readSecret } = await import('../shared/server/credentials/local-store');
    expect(readSecret('slack', 'bot_token', { botInstallationId: install?.id })).toBe('xoxb-test');
  });
});
