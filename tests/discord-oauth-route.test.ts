import { Readable } from 'node:stream';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const ensureStarted = vi.fn();

function request(headers: Record<string, string> = {}): any {
  const req = Readable.from([]) as any;
  req.method = 'GET';
  req.headers = { host: 'localhost:5173', ...headers };
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

  const tokenRequests: URLSearchParams[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url, init = {}) => {
    const auth = new Headers((init as RequestInit).headers).get('authorization') ?? '';
    const target = String(url);
    if (target.includes('/oauth2/token')) {
      tokenRequests.push(new URLSearchParams(String((init as RequestInit).body ?? '')));
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
  vi.doMock('#shared/server/runtime/bootstrap', () => ({
    ensureRuntimeInitialized: vi.fn().mockResolvedValue(undefined)
  }));
  vi.doMock('#shared/server/capabilities/channel-registry', () => ({
    getChannelRegistry: () => ({
      getIngress: () => ({ start: ensureStarted })
    })
  }));

  const { discordRoutes } = await import('../shared/server/routes/discord');
  const { dispatchRoute } = await import('../shared/server/router');
  const { getStore } = await import('#shared/server/persistence/store');

  async function get(pathname: string, headers: Record<string, string> = {}) {
    const res = response();
    await dispatchRoute(discordRoutes, {
      req: request(headers),
      res,
      url: new URL(pathname, 'http://localhost:5173')
    });
    return res.result();
  }

  return { get, root, store: getStore(), tokenRequests };
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
    const { get, store } = await setup();
    store.upsertAppSettings({
      setupDefaults: {
        ownerUserId: 'U_SLACK',
        ownerDisplayName: 'Slack Owner'
      }
    });

    const result = await get('/api/discord/oauth/callback?code=abc&guild_id=G1');

    expect(result.status).toBe(302);
    expect(result.headers.location).toMatch(/^\/settings\?installed=discord&workspaceId=/);
    expect(store.getAppSettings().setupDefaults).toMatchObject({
      ownerUserId: 'U_SLACK',
      ownerDisplayName: 'Slack Owner',
      workspaceOwners: [
        expect.objectContaining({
          ownerUserId: 'U_DISCORD',
          ownerDisplayName: 'Danny'
        })
      ]
    });
    const workspace = store.getWorkspaceByExternalId('discord', 'G1');
    expect(workspace && store.getUser(workspace.id, 'U_DISCORD')?.displayName).toBe('Danny');
    expect(workspace && store.getProviderSettings(workspace.id)).toBeUndefined();
    expect(ensureStarted).toHaveBeenCalledOnce();
  });

  it('redirects install requests to Discord advanced bot authorization', async () => {
    const { get } = await setup();

    const result = await get('/api/discord/install?source=setup', {
      'x-forwarded-host': 'murph.example.com',
      'x-forwarded-proto': 'https'
    });

    expect(result.status).toBe(302);
    const location = new URL(result.headers.location);
    expect(location.origin).toBe('https://discord.com');
    expect(location.pathname).toBe('/oauth2/authorize');
    expect(location.searchParams.get('client_id')).toBe('discord-client-id');
    expect(location.searchParams.get('scope')).toBe('bot identify');
    expect(location.searchParams.get('response_type')).toBe('code');
    expect(location.searchParams.get('redirect_uri')).toBe('https://murph.example.com/api/discord/oauth/callback');
    expect(location.searchParams.get('state')).toBeTruthy();
  });

  it('returns setup-sourced Discord installs to the setup wizard', async () => {
    const { get, tokenRequests } = await setup();
    const headers = {
      'x-forwarded-host': 'murph.example.com',
      'x-forwarded-proto': 'https'
    };
    const installResult = await get('/api/discord/install?source=setup', headers);
    const installLocation = new URL(installResult.headers.location);
    const state = encodeURIComponent(installLocation.searchParams.get('state') ?? '');

    const callbackResult = await get(`/api/discord/oauth/callback?code=abc&guild_id=G1&state=${state}`, headers);

    expect(callbackResult.status).toBe(302);
    expect(tokenRequests[0].get('redirect_uri')).toBe('https://murph.example.com/api/discord/oauth/callback');
    expect(callbackResult.headers.location).toMatch(/^\/setup\?step=discord&role=channel&success=1&workspaceId=/);
    expect(ensureStarted).toHaveBeenCalledOnce();
  });

  it('saves a personal OAuth owner as the primary setup owner when none exists', async () => {
    process.env.DISCORD_PERSONAL_CLIENT_ID = 'discord-personal-client-id';
    process.env.DISCORD_PERSONAL_CLIENT_SECRET = 'discord-personal-client-secret';
    process.env.DISCORD_PERSONAL_BOT_TOKEN = 'discord-personal-bot-token';
    const { get, store } = await setup();
    process.env.DISCORD_PERSONAL_CLIENT_ID = 'discord-personal-client-id';
    process.env.DISCORD_PERSONAL_CLIENT_SECRET = 'discord-personal-client-secret';
    process.env.DISCORD_PERSONAL_BOT_TOKEN = 'discord-personal-bot-token';
    const installResult = await get('/api/discord/personal/install?source=setup');
    const installLocation = new URL(installResult.headers.location);
    const state = encodeURIComponent(installLocation.searchParams.get('state') ?? '');

    const callbackResult = await get(`/api/discord/oauth/callback?code=abc&state=${state}`);

    expect(callbackResult.status).toBe(302);
    expect(callbackResult.headers.location).toMatch(/^\/setup\?step=discord&role=personal&success=1&workspaceId=/);
    expect(store.getAppSettings().setupDefaults).toMatchObject({
      botRoles: ['personal'],
      providerBotRoles: {
        discord: ['personal']
      },
      channelProvider: 'discord',
      ownerUserId: 'U_DISCORD',
      ownerDisplayName: 'Daniel Discord',
      workspaceOwners: [
        expect.objectContaining({
          ownerUserId: 'U_DISCORD',
          ownerDisplayName: 'Daniel Discord'
        })
      ]
    });
  });

  it('returns CLI-sourced Discord installs to the terminal completion page', async () => {
    const { get } = await setup();
    const installResult = await get('/api/discord/install?source=cli');
    const installLocation = new URL(installResult.headers.location);
    const state = encodeURIComponent(installLocation.searchParams.get('state') ?? '');

    const callbackResult = await get(`/api/discord/oauth/callback?code=abc&guild_id=G1&state=${state}`);

    expect(callbackResult.status).toBe(302);
    expect(callbackResult.headers.location).toBe('/oauth/cli-complete?provider=discord&role=channel&status=success');
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
