import { Readable } from 'node:stream';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

function jsonRequest(method: string, body?: unknown): any {
  const req = Readable.from(body === undefined ? [] : [JSON.stringify(body)]) as any;
  req.method = method;
  req.headers = {};
  return req;
}

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

async function setup() {
  vi.resetModules();
  const workspaceDir = mkdtempSync(join(tmpdir(), 'murph-setup-defaults-route-'));
  process.env.MURPH_APP_DIR = workspaceDir;
  process.env.MURPH_CONFIG_PATH = join(workspaceDir, 'config.yaml');
  process.env.MURPH_SQLITE_PATH = join(workspaceDir, 'murph.sqlite');
  process.env.MURPH_CREDENTIALS_PATH = join(workspaceDir, '.credentials');
  process.env.MURPH_ENCRYPTION_KEY = 'test-key';
  process.env.OPENAI_API_KEY = 'sk-test';
  process.env.SLACK_EVENTS_MODE = 'socket';
  process.env.SLACK_APP_TOKEN = 'xapp-test';
  process.env.SLACK_CLIENT_ID = 'client-id';
  process.env.SLACK_CLIENT_SECRET = 'client-secret';
  delete process.env.DISCORD_BOT_TOKEN;
  delete process.env.DISCORD_CLIENT_ID;
  delete process.env.GOOGLE_CLIENT_ID;
  delete process.env.GOOGLE_CLIENT_SECRET;

  vi.doMock('#lib/server/runtime/bootstrap', () => ({
    ensureRuntimeInitialized: vi.fn().mockResolvedValue(undefined)
  }));

  const { getStore } = await import('#lib/server/persistence/store');
  const { writeSecret } = await import('#lib/server/credentials/local-store');
  const store = getStore();
  const workspace = store.saveInstall({
    provider: 'slack',
    externalWorkspaceId: 'T1',
    name: 'Test Workspace',
    botUserId: 'UTZBOT'
  });
  writeSecret('slack', 'bot_token', 'xoxb-test', {
    workspaceId: workspace.id,
    externalWorkspaceId: workspace.externalWorkspaceId
  });
  const { systemRoutes } = await import('../../src/server/routes/system');
  const { dispatchRoute } = await import('../../src/server/router');

  async function request(method: string, path: string, body?: unknown) {
    const req = jsonRequest(method, body);
    const res = jsonResponse();
    await dispatchRoute(systemRoutes, {
      req,
      res,
      url: new URL(path, 'http://localhost')
    });
    return res.result();
  }

  return { request, store, workspace };
}

describe('setup defaults routes', () => {
  const originalCwd = process.cwd();
  const originalAppDir = process.env.MURPH_APP_DIR;
  const originalConfigPath = process.env.MURPH_CONFIG_PATH;

  beforeEach(() => {
    vi.restoreAllMocks();
    process.chdir(originalCwd);
    if (originalAppDir === undefined) {
      delete process.env.MURPH_APP_DIR;
    } else {
      process.env.MURPH_APP_DIR = originalAppDir;
    }
    if (originalConfigPath === undefined) {
      delete process.env.MURPH_CONFIG_PATH;
    } else {
      process.env.MURPH_CONFIG_PATH = originalConfigPath;
    }
  });

  afterEach(() => {
    process.chdir(originalCwd);
    if (originalAppDir === undefined) {
      delete process.env.MURPH_APP_DIR;
    } else {
      process.env.MURPH_APP_DIR = originalAppDir;
    }
    if (originalConfigPath === undefined) {
      delete process.env.MURPH_CONFIG_PATH;
    } else {
      process.env.MURPH_CONFIG_PATH = originalConfigPath;
    }
  });

  it('saves owner, selected channels, and schedule as shared setup defaults', async () => {
    const { request, store, workspace } = await setup();

    const response = await request('PUT', '/api/setup/defaults', {
      ownerUserId: 'U1',
      ownerDisplayName: 'Daniel',
      channelScopeMode: 'selected',
      selectedChannels: [{ id: 'C1', displayName: '#product' }],
      timezone: 'America/Los_Angeles',
      workdayStartHour: 8,
      workdayEndHour: 16
    });

    expect(response.status).toBe(200);
    expect(response.body.defaults).toEqual(expect.objectContaining({
      ownerUserId: 'U1',
      ownerDisplayName: 'Daniel',
      channelScopeMode: 'selected',
      selectedChannels: [{ id: 'C1', displayName: '#product' }]
    }));
    expect(store.getUser(workspace.id, 'U1')?.schedule).toEqual({
      timezone: 'America/Los_Angeles',
      workdayStartHour: 8,
      workdayEndHour: 16
    });
    expect(store.getAppSettings().setupDefaults).toBeUndefined();
    expect(readFileSync(process.env.MURPH_CONFIG_PATH!, 'utf8')).toContain('ownerUserId: U1');
    expect(readFileSync(process.env.MURPH_CONFIG_PATH!, 'utf8')).toContain('displayName: "#product"');
  });

  it('marks setup ready only after identity and channels are configured', async () => {
    const { request } = await setup();

    const before = await request('GET', '/api/setup/doctor');
    expect(before.body.ready).toBe(false);
    expect(before.body.nextStep).toBe('identity');

    await request('PUT', '/api/setup/defaults', {
      ownerUserId: 'U1',
      ownerDisplayName: 'Daniel',
      channelScopeMode: 'all_accessible',
      timezone: 'America/Los_Angeles',
      workdayStartHour: 9,
      workdayEndHour: 17
    });

    const after = await request('GET', '/api/setup/doctor');
    expect(after.body.ready).toBe(true);
    expect(after.body.nextStep).toBe('ready');
  });

  it('round-trips workspace-specific owner defaults', async () => {
    const { request, store, workspace } = await setup();
    const discordWorkspace = store.saveInstall({
      provider: 'discord',
      externalWorkspaceId: 'G1',
      name: 'Test Server',
      botUserId: 'DBOT'
    });

    const response = await request('PUT', '/api/setup/defaults', {
      ownerUserId: 'USLACK',
      ownerDisplayName: 'Slack Daniel',
      workspaceId: workspace.id,
      channelScopeMode: 'all_accessible',
      workspaceOwners: [
        { workspaceId: workspace.id, ownerUserId: 'USLACK', ownerDisplayName: 'Slack Daniel' },
        { workspaceId: discordWorkspace.id, ownerUserId: '1234567890', ownerDisplayName: 'Discord Daniel' }
      ]
    });
    expect(response.status).toBe(200);
    expect(response.body.defaults.workspaceOwners).toEqual([
      { workspaceId: workspace.id, ownerUserId: 'USLACK', ownerDisplayName: 'Slack Daniel' },
      { workspaceId: discordWorkspace.id, ownerUserId: '1234567890', ownerDisplayName: 'Discord Daniel' }
    ]);

    const slackDefaults = await request('GET', `/api/setup/defaults?workspaceId=${workspace.id}`);
    const discordDefaults = await request('GET', `/api/setup/defaults?workspaceId=${discordWorkspace.id}`);

    expect(slackDefaults.body.defaults.ownerUserId).toBe('USLACK');
    expect(discordDefaults.body.defaults.ownerUserId).toBe('1234567890');
    expect(store.getUser(discordWorkspace.id, '1234567890')?.displayName).toBe('Discord Daniel');
    expect(readFileSync(process.env.MURPH_CONFIG_PATH!, 'utf8')).toContain('workspaceOwners:');
    expect(readFileSync(process.env.MURPH_CONFIG_PATH!, 'utf8')).toContain('ownerUserId: "1234567890"');
  });

  it('marks setup not ready when event ingress has a blocking error', async () => {
    const { request } = await setup();
    const { markIngressError } = await import('#lib/server/channels/ingress-health');
    await request('PUT', '/api/setup/defaults', {
      ownerUserId: 'U1',
      ownerDisplayName: 'Daniel',
      channelScopeMode: 'all_accessible',
      timezone: 'America/Los_Angeles',
      workdayStartHour: 9,
      workdayEndHour: 17
    });

    markIngressError('slack', new Error('An API error occurred: invalid_auth'));

    const response = await request('GET', '/api/setup/doctor');
    expect(response.body.ready).toBe(false);
    expect(response.body.checks).toContainEqual(expect.objectContaining({
      id: 'slack_ingress',
      status: 'action_required'
    }));
  });

  it('returns connected Slack workspace metadata in setup status', async () => {
    const { request } = await setup();

    const response = await request('GET', '/api/setup/status');

    expect(response.status).toBe(200);
    expect(response.body.slack.workspace).toEqual(expect.objectContaining({
      externalWorkspaceId: 'T1',
      name: 'Test Workspace'
    }));
  });

  it('returns all channel workspaces and Discord setup metadata in setup status', async () => {
    const { request, store } = await setup();
    store.saveInstall({
      provider: 'discord',
      externalWorkspaceId: 'G1',
      name: 'Test Server',
      botUserId: 'bot-user-1'
    });
    await request('POST', '/api/setup/config', {
      DISCORD_CLIENT_ID: 'discord-client-id',
      DISCORD_BOT_TOKEN: 'discord-token'
    });

    const response = await request('GET', '/api/setup/status');

    expect(response.status).toBe(200);
    expect(response.body.discord).toEqual(expect.objectContaining({
      installed: true,
      botTokenConfigured: true,
      clientIdConfigured: true,
      clientSecretConfigured: false,
      oauthConfigured: false
    }));
    expect(response.body.channelWorkspaces).toEqual(expect.arrayContaining([
      expect.objectContaining({ provider: 'slack', name: 'Test Workspace' }),
      expect.objectContaining({ provider: 'discord', name: 'Test Server' })
    ]));
  });

  it('treats workspace-scoped Discord bot credentials as configured', async () => {
    const { request, store } = await setup();
    const { writeSecret } = await import('../../src/lib/server/credentials/local-store');
    const discordWorkspace = store.saveInstall({
      provider: 'discord',
      externalWorkspaceId: 'G1',
      name: 'Test Server',
      botUserId: 'bot-user-1'
    });
    writeSecret('discord', 'bot_token', 'discord-token', {
      workspaceId: discordWorkspace.id,
      externalWorkspaceId: discordWorkspace.externalWorkspaceId
    });

    const response = await request('GET', '/api/setup/status');

    expect(response.status).toBe(200);
    expect(response.body.discord).toEqual(expect.objectContaining({
      installed: true,
      botTokenConfigured: true
    }));
  });

  it('stores Google OAuth client settings through setup config', async () => {
    const { request } = await setup();

    const response = await request('POST', '/api/setup/config', {
      GOOGLE_CLIENT_ID: 'google-client-id',
      GOOGLE_CLIENT_SECRET: 'google-client-secret'
    });
    const { getRuntimeEnv } = await import('#lib/server/util/env');

    expect(response.status).toBe(200);
    expect(response.body.updated).toEqual(expect.arrayContaining(['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET']));
    expect(readFileSync(process.env.MURPH_CONFIG_PATH!, 'utf8')).toContain('clientId: google-client-id');
    expect(getRuntimeEnv().googleClientId).toBe('google-client-id');
    expect(getRuntimeEnv().googleClientSecret).toBe('google-client-secret');
  });
});
