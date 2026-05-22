import { Readable } from 'node:stream';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
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

async function setup(options: { configYaml?: string } = {}) {
  vi.resetModules();
  ensureStarted.mockReset();
  const root = mkdtempSync(path.join(tmpdir(), 'murph-discord-oauth-route-'));
  process.env.MURPH_CONFIG_PATH = path.join(root, 'config.yaml');
  process.env.MURPH_SQLITE_PATH = path.join(root, 'murph.sqlite');
  process.env.MURPH_CREDENTIALS_PATH = path.join(root, '.credentials');
  process.env.MURPH_ENCRYPTION_KEY = 'test-key';
  process.env.DISCORD_CLIENT_ID = 'discord-client-id';
  process.env.DISCORD_CLIENT_SECRET = 'discord-client-secret';
  process.env.DISCORD_BOT_TOKEN = 'discord-bot-token';
  process.env.OPENAI_API_KEY = 'sk-test';
  if (options.configYaml) {
    writeFileSync(process.env.MURPH_CONFIG_PATH, options.configYaml);
  }

  vi.stubGlobal('fetch', vi.fn(async (url, init = {}) => {
    const auth = new Headers((init as RequestInit).headers).get('authorization') ?? '';
    const target = String(url);
    if (target.includes('/oauth2/token')) {
      return Response.json({ access_token: 'discord-user-token', token_type: 'Bearer', scope: 'identify' });
    }
    if (target.endsWith('/guilds/G1')) {
      return Response.json({ id: 'G1', name: 'Discord Guild' });
    }
    if (target.endsWith('/users/@me') && auth.startsWith('Bot ')) {
      return Response.json({ id: 'DBOT', username: 'murph-bot', bot: true });
    }
    if (target.endsWith('/users/@me') && auth.startsWith('Bearer ')) {
      return Response.json({ id: 'U_DISCORD', username: 'daniel', global_name: 'Daniel Discord' });
    }
    if (target.endsWith('/guilds/G1/members/U_DISCORD')) {
      return Response.json({
        user: { id: 'U_DISCORD', username: 'daniel', global_name: 'Daniel Discord' },
        nick: 'Danny'
      });
    }
    return Response.json({ message: 'not found' }, { status: 404 });
  }));
  vi.doMock('#lib/server/runtime/bootstrap', () => ({
    ensureRuntimeInitialized: vi.fn().mockResolvedValue(undefined)
  }));
  vi.doMock('#lib/server/capabilities/channel-registry', () => ({
    getChannelRegistry: () => ({
      getIngress: () => ({ start: ensureStarted })
    })
  }));

  const { discordRoutes } = await import('../src/server/routes/discord');
  const { dispatchRoute } = await import('../src/server/router');
  const { getStore } = await import('#lib/server/persistence/store');

  async function get(pathname: string) {
    const res = response();
    await dispatchRoute(discordRoutes, {
      req: request(),
      res,
      url: new URL(pathname, 'http://localhost:5173')
    });
    return res.result();
  }

  return { get, root, store: getStore() };
}

describe('Discord OAuth callback route', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    delete process.env.MURPH_CONFIG_PATH;
    delete process.env.MURPH_SQLITE_PATH;
    delete process.env.MURPH_CREDENTIALS_PATH;
    delete process.env.MURPH_ENCRYPTION_KEY;
    delete process.env.DISCORD_CLIENT_ID;
    delete process.env.DISCORD_CLIENT_SECRET;
    delete process.env.DISCORD_BOT_TOKEN;
    delete process.env.OPENAI_API_KEY;
  });

  it('saves the OAuth user as the Discord workspace owner', async () => {
    const { get, root, store } = await setup({
      configYaml: [
        'setup:',
        '  ownerUserId: U_SLACK',
        '  ownerDisplayName: Slack Owner',
        ''
      ].join('\n')
    });

    const result = await get('/api/discord/oauth/callback?code=abc&guild_id=G1');

    expect(result.status).toBe(302);
    expect(result.headers.location).toMatch(/^\/settings\?installed=discord&workspaceId=/);
    const config = readFileSync(path.join(root, 'config.yaml'), 'utf8');
    expect(config).toContain('ownerUserId: U_SLACK');
    expect(config).toContain('workspaceOwners:');
    expect(config).toContain('ownerUserId: U_DISCORD');
    expect(config).toContain('ownerDisplayName: Danny');
    const workspace = store.getWorkspaceByExternalId('discord', 'G1');
    expect(workspace && store.getUser(workspace.id, 'U_DISCORD')?.displayName).toBe('Danny');
    expect(workspace && store.getProviderSettings(workspace.id)).toBeUndefined();
    expect(ensureStarted).toHaveBeenCalledOnce();
  });

  it('redirects install requests to Discord advanced bot authorization', async () => {
    const { get } = await setup();

    const result = await get('/api/discord/install?source=setup');

    expect(result.status).toBe(302);
    const location = new URL(result.headers.location);
    expect(location.origin).toBe('https://discord.com');
    expect(location.pathname).toBe('/oauth2/authorize');
    expect(location.searchParams.get('client_id')).toBe('discord-client-id');
    expect(location.searchParams.get('scope')).toBe('bot identify');
    expect(location.searchParams.get('response_type')).toBe('code');
    expect(location.searchParams.get('redirect_uri')).toBe('http://localhost:5173/api/discord/oauth/callback');
    expect(location.searchParams.get('state')).toBeTruthy();
  });

  it('returns setup-sourced Discord installs to the setup wizard', async () => {
    const { get } = await setup();
    const installResult = await get('/api/discord/install?source=setup');
    const installLocation = new URL(installResult.headers.location);
    const state = encodeURIComponent(installLocation.searchParams.get('state') ?? '');

    const callbackResult = await get(`/api/discord/oauth/callback?code=abc&guild_id=G1&state=${state}`);

    expect(callbackResult.status).toBe(302);
    expect(callbackResult.headers.location).toMatch(/^\/setup\?step=discord&success=1&workspaceId=/);
    expect(ensureStarted).toHaveBeenCalledOnce();
  });

  it('rejects invalid OAuth state', async () => {
    const { get } = await setup();

    const result = await get('/api/discord/oauth/callback?code=abc&guild_id=G1&state=bad');

    expect(result.status).toBe(302);
    expect(result.headers.location).toContain('error=discord_oauth_failed');
    expect(result.headers.location).toContain('invalid_state');
    expect(ensureStarted).not.toHaveBeenCalled();
  });

  it('redirects with a setup error when Discord does not return a guild id', async () => {
    const { get } = await setup();

    const result = await get('/api/discord/oauth/callback?code=abc');

    expect(result.status).toBe(302);
    expect(result.headers.location).toContain('error=discord_oauth_failed');
    expect(result.headers.location).toContain('Discord%20OAuth%20callback%20is%20missing%20guild_id');
    expect(ensureStarted).not.toHaveBeenCalled();
  });
});
