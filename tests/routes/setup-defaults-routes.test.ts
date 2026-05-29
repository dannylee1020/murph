import { Readable } from 'node:stream';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const channelManifest = [
  'display_information:',
  '  name: Murph',
  'features:',
  '  slash_commands:',
  '    - command: /murph',
  '      description: Open Murph Personal',
  '      should_escape: true',
  '  shortcuts:',
  '    - name: Send to Murph Personal',
  '      type: message',
  '      callback_id: murph_personal_handoff',
  'oauth_config:',
  '  redirect_urls:',
  '    - http://localhost:5173/api/slack/oauth/callback',
  '  scopes:',
  '    bot:',
  '      - app_mentions:read',
  '      - channels:history',
  '      - chat:write',
  '      - commands',
  '      - groups:history',
  '    user:',
  '      - search:read',
  'settings:',
  '  event_subscriptions:',
  '    bot_events:',
  '      - app_mention',
  '      - message.channels',
  '      - message.groups',
  '  interactivity:',
  '    is_enabled: true',
  '  socket_mode_enabled: true',
  ''
].join('\n');

const personalManifest = [
  'display_information:',
  '  name: Murph Personal',
  'oauth_config:',
  '  redirect_urls:',
  '    - http://localhost:5173/api/slack/oauth/callback',
  '  scopes:',
  '    bot:',
  '      - chat:write',
  '      - im:history',
  '      - im:write',
  'settings:',
  '  event_subscriptions:',
  '    bot_events:',
  '      - message.im',
  '  socket_mode_enabled: true',
  ''
].join('\n');

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

function textResponse(): any & { result: () => { status: number; body: string; headers: Record<string, string> } } {
  let status = 200;
  let payload = '';
  let headers: Record<string, string> = {};
  return {
    writeHead(nextStatus: number, nextHeaders: Record<string, string>) {
      status = nextStatus;
      headers = nextHeaders;
    },
    end(nextPayload: string) {
      payload = nextPayload;
    },
    result() {
      return { status, body: payload, headers };
    }
  };
}

async function setup(input: { productMode?: 'personal' | 'channel'; botRolesEnv?: string; skipSlackToken?: boolean } = {}) {
  vi.resetModules();
  const workspaceDir = mkdtempSync(join(tmpdir(), 'murph-setup-defaults-route-'));
  mkdirSync(join(workspaceDir, 'docs/public'), { recursive: true });
  writeFileSync(join(workspaceDir, 'docs/public/slack-manifest.yaml'), channelManifest);
  writeFileSync(join(workspaceDir, 'docs/public/slack-channel-manifest.yaml'), channelManifest);
  writeFileSync(join(workspaceDir, 'docs/public/slack-personal-manifest.yaml'), personalManifest);
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
  delete process.env.SLACK_APP_ID;
  delete process.env.SLACK_CHANNEL_APP_ID;
  delete process.env.SLACK_CHANNEL_APP_TOKEN;
  delete process.env.SLACK_CHANNEL_CLIENT_ID;
  delete process.env.SLACK_CHANNEL_CLIENT_SECRET;
  delete process.env.SLACK_CHANNEL_SIGNING_SECRET;
  delete process.env.SLACK_PERSONAL_APP_ID;
  delete process.env.SLACK_PERSONAL_APP_TOKEN;
  delete process.env.SLACK_PERSONAL_CLIENT_ID;
  delete process.env.SLACK_PERSONAL_CLIENT_SECRET;
  delete process.env.SLACK_PERSONAL_SIGNING_SECRET;
  if (input.productMode) {
    process.env.MURPH_PRODUCT_MODE = input.productMode;
  } else {
    delete process.env.MURPH_PRODUCT_MODE;
  }
  if (input.botRolesEnv) {
    process.env.MURPH_BOT_ROLES = input.botRolesEnv;
  } else {
    delete process.env.MURPH_BOT_ROLES;
  }
  delete process.env.DISCORD_BOT_TOKEN;
  delete process.env.DISCORD_CLIENT_ID;
  delete process.env.DISCORD_CLIENT_SECRET;
  delete process.env.DISCORD_CHANNEL_BOT_TOKEN;
  delete process.env.DISCORD_CHANNEL_CLIENT_ID;
  delete process.env.DISCORD_CHANNEL_CLIENT_SECRET;
  delete process.env.DISCORD_PERSONAL_BOT_TOKEN;
  delete process.env.DISCORD_PERSONAL_CLIENT_ID;
  delete process.env.DISCORD_PERSONAL_CLIENT_SECRET;
  delete process.env.GOOGLE_CLIENT_ID;
  delete process.env.GOOGLE_CLIENT_SECRET;

  vi.doMock('#shared/server/runtime/bootstrap', () => ({
    ensureRuntimeInitialized: vi.fn().mockResolvedValue(undefined)
  }));

  const { getStore } = await import('#shared/server/persistence/store');
  const { writeSecret } = await import('#shared/server/credentials/local-store');
  const store = getStore();
  const workspace = store.saveInstall({
    provider: 'slack',
    externalWorkspaceId: 'T1',
    name: 'Test Workspace',
    botUserId: 'UTZBOT'
  });
  const botInstallation = store.getBotInstallation('slack', workspace.externalWorkspaceId, 'channel');
  if (!input.skipSlackToken) {
    writeSecret('slack', 'bot_token', 'xoxb-test', {
      workspaceId: workspace.id,
      externalWorkspaceId: workspace.externalWorkspaceId,
      botInstallationId: botInstallation?.id
    });
  }
  const { systemRoutes } = await import('../../shared/server/routes/system');
  const { dispatchRoute } = await import('../../shared/server/router');

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

  async function requestText(method: string, path: string) {
    const req = jsonRequest(method);
    const res = textResponse();
    await dispatchRoute(systemRoutes, {
      req,
      res,
      url: new URL(path, 'http://localhost')
    });
    return res.result();
  }

  return { request, requestText, store, workspace };
}

async function seedWorkspaceOwner(
  workspace: { id: string; provider: string },
  ownerUserId = 'U1',
  ownerDisplayName = 'Daniel'
) {
  const { getStore } = await import('#shared/server/persistence/store');
  const { updateMurphSetupDefaults } = await import('../../shared/server/setup/config-file');
  getStore().upsertUser({
    workspaceId: workspace.id,
    externalUserId: ownerUserId,
    displayName: ownerDisplayName
  });
  updateMurphSetupDefaults({
    channelProvider: workspace.provider,
    workspaceId: workspace.id,
    ownerUserId,
    ownerDisplayName,
    workspaceOwners: [{ workspaceId: workspace.id, ownerUserId, ownerDisplayName }]
  });
}

describe('setup defaults routes', () => {
  const originalCwd = process.cwd();
  const originalAppDir = process.env.MURPH_APP_DIR;
  const originalConfigPath = process.env.MURPH_CONFIG_PATH;
  const originalBotRoles = process.env.MURPH_BOT_ROLES;
  const originalSlackApiBase = process.env.MURPH_SLACK_API_BASE;

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
    if (originalBotRoles === undefined) {
      delete process.env.MURPH_BOT_ROLES;
    } else {
      process.env.MURPH_BOT_ROLES = originalBotRoles;
    }
    if (originalSlackApiBase === undefined) {
      delete process.env.MURPH_SLACK_API_BASE;
    } else {
      process.env.MURPH_SLACK_API_BASE = originalSlackApiBase;
    }
  });

  afterEach(() => {
    vi.unstubAllGlobals();
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
    if (originalBotRoles === undefined) {
      delete process.env.MURPH_BOT_ROLES;
    } else {
      process.env.MURPH_BOT_ROLES = originalBotRoles;
    }
    if (originalSlackApiBase === undefined) {
      delete process.env.MURPH_SLACK_API_BASE;
    } else {
      process.env.MURPH_SLACK_API_BASE = originalSlackApiBase;
    }
  });

  it('renders a standalone CLI OAuth completion page without the setup app', async () => {
    const { requestText } = await setup();

    const response = await requestText('GET', '/oauth/cli-complete?provider=slack&role=personal&status=success');

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toBe('text/html; charset=utf-8');
    expect(response.body).toContain('slack connected');
    expect(response.body).toContain('Return to your terminal');
    expect(response.body).not.toContain('/api/setup/status');
  });

  it('saves owner, selected channels, and schedule as shared setup defaults', async () => {
    const { request, store, workspace } = await setup();
    await seedWorkspaceOwner(workspace);

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
    expect(store.getWorkspaceSubscription(workspace.id, 'U1')).toEqual(expect.objectContaining({
      status: 'active',
      channelScopeMode: 'selected',
      channelScope: ['C1']
    }));
    expect(store.getAppSettings().setupDefaults).toBeUndefined();
    expect(readFileSync(process.env.MURPH_CONFIG_PATH!, 'utf8')).toContain('ownerUserId: U1');
    expect(readFileSync(process.env.MURPH_CONFIG_PATH!, 'utf8')).toContain('displayName: "#product"');
  });

  it('does not create a selected-empty subscription before channels are configured', async () => {
    const { request, store, workspace } = await setup();
    await seedWorkspaceOwner(workspace);

    const response = await request('PUT', '/api/setup/defaults', {
      ownerUserId: 'U1',
      ownerDisplayName: 'Daniel',
      timezone: 'America/Los_Angeles',
      workdayStartHour: 8,
      workdayEndHour: 16
    });

    expect(response.status).toBe(200);
    expect(store.getUser(workspace.id, 'U1')).toBeDefined();
    expect(store.getWorkspaceSubscription(workspace.id, 'U1')).toBeUndefined();
  });

  it('updates an existing owner subscription when setup channel defaults change', async () => {
    const { request, store, workspace } = await setup();
    await seedWorkspaceOwner(workspace);

    await request('PUT', '/api/setup/defaults', {
      ownerUserId: 'U1',
      ownerDisplayName: 'Daniel',
      channelScopeMode: 'all_accessible'
    });
    expect(store.getWorkspaceSubscription(workspace.id, 'U1')).toEqual(expect.objectContaining({
      channelScopeMode: 'all_accessible',
      channelScope: []
    }));

    const response = await request('PUT', '/api/setup/defaults', {
      ownerUserId: 'U1',
      ownerDisplayName: 'Daniel',
      channelScopeMode: 'selected',
      selectedChannels: [{ id: 'C2', displayName: '#support' }]
    });

    expect(response.status).toBe(200);
    expect(store.getWorkspaceSubscription(workspace.id, 'U1')).toEqual(expect.objectContaining({
      channelScopeMode: 'selected',
      channelScope: ['C2']
    }));
  });

  it('marks setup ready only after identity and channels are configured', async () => {
    const { request, workspace } = await setup();

    const before = await request('GET', '/api/setup/doctor');
    expect(before.body.ready).toBe(false);
    expect(before.body.nextStep).toBe('identity');

    await seedWorkspaceOwner(workspace);
    const afterIdentity = await request('GET', '/api/setup/doctor');
    expect(afterIdentity.body.ready).toBe(false);
    expect(afterIdentity.body.nextStep).toBe('channels');

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
    const { updateMurphSetupDefaults } = await import('../../shared/server/setup/config-file');
    updateMurphSetupDefaults({
      ownerUserId: 'USLACK',
      ownerDisplayName: 'Slack Daniel',
      workspaceId: workspace.id,
      channelProvider: 'slack',
      workspaceOwners: [
        { workspaceId: workspace.id, ownerUserId: 'USLACK', ownerDisplayName: 'Slack Daniel' },
        { workspaceId: discordWorkspace.id, ownerUserId: '1234567890', ownerDisplayName: 'Discord Daniel' }
      ]
    });

    const response = await request('PUT', '/api/setup/defaults', {
      ownerUserId: 'USLACK',
      ownerDisplayName: 'Slack Daniel',
      workspaceId: workspace.id,
      channelScopeMode: 'all_accessible',
      workspaceOwners: [
        { workspaceId: workspace.id, ownerUserId: 'USLACK', ownerDisplayName: 'Slack Daniel' },
        { workspaceId: discordWorkspace.id, ownerUserId: '1234567890', ownerDisplayName: 'Discord Daniel' }
      ],
      workspaceChannels: [
        { workspaceId: workspace.id, channelScopeMode: 'all_accessible', selectedChannels: [] },
        {
          workspaceId: discordWorkspace.id,
          channelScopeMode: 'selected',
          selectedChannels: [{ id: 'D1', displayName: '#standup' }]
        }
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
    expect(store.getWorkspaceSubscription(workspace.id, 'USLACK')).toEqual(expect.objectContaining({
      channelScopeMode: 'all_accessible',
      channelScope: []
    }));
    expect(store.getWorkspaceSubscription(discordWorkspace.id, '1234567890')).toEqual(expect.objectContaining({
      channelScopeMode: 'selected',
      channelScope: ['D1']
    }));
    expect(readFileSync(process.env.MURPH_CONFIG_PATH!, 'utf8')).toContain('workspaceOwners:');
    expect(readFileSync(process.env.MURPH_CONFIG_PATH!, 'utf8')).toContain('ownerUserId: "1234567890"');
  });

  it('round-trips workspace-specific channel defaults', async () => {
    const { request, store, workspace } = await setup();
    const discordWorkspace = store.saveInstall({
      provider: 'discord',
      externalWorkspaceId: 'G1',
      name: 'Test Server',
      botUserId: 'DBOT'
    });

    const response = await request('PUT', '/api/setup/defaults', {
      workspaceId: workspace.id,
      channelProvider: 'slack',
      channelScopeMode: 'selected',
      selectedChannels: [{ id: 'C1', displayName: '#product' }],
      workspaceChannels: [
        {
          workspaceId: workspace.id,
          channelScopeMode: 'selected',
          selectedChannels: [{ id: 'C1', displayName: '#product' }]
        },
        {
          workspaceId: discordWorkspace.id,
          channelScopeMode: 'all_accessible',
          selectedChannels: []
        }
      ]
    });

    expect(response.status).toBe(200);
    expect(response.body.defaults.workspaceChannels).toEqual([
      {
        workspaceId: workspace.id,
        channelScopeMode: 'selected',
        selectedChannels: [{ id: 'C1', displayName: '#product' }]
      },
      {
        workspaceId: discordWorkspace.id,
        channelScopeMode: 'all_accessible',
        selectedChannels: []
      }
    ]);

    const slackDefaults = await request('GET', `/api/setup/defaults?workspaceId=${workspace.id}`);
    const discordDefaults = await request('GET', `/api/setup/defaults?workspaceId=${discordWorkspace.id}`);

    expect(slackDefaults.body.defaults.channelScopeMode).toBe('selected');
    expect(slackDefaults.body.defaults.selectedChannels).toEqual([{ id: 'C1', displayName: '#product' }]);
    expect(discordDefaults.body.defaults.channelScopeMode).toBe('all_accessible');
    expect(discordDefaults.body.defaults.selectedChannels).toEqual([]);
    expect(readFileSync(process.env.MURPH_CONFIG_PATH!, 'utf8')).toContain('workspaceChannels:');
  });

  it('marks setup not ready when event ingress has a blocking error', async () => {
    const { request, workspace } = await setup();
    const { markIngressError } = await import('#shared/server/channels/ingress-health');
    await seedWorkspaceOwner(workspace);
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

  it('does not mark Slack channel bot installed when the role token is missing', async () => {
    const { request } = await setup({ skipSlackToken: true });

    const response = await request('GET', '/api/setup/status');

    expect(response.status).toBe(200);
    expect(response.body.slack.installed).toBe(false);
    expect(response.body.slack.roles.channel.installed).toBe(false);
  });

  it('does not mark Slack personal bot installed from a channel bot token fallback', async () => {
    const { request, store } = await setup();
    const workspace = store.getWorkspaceByExternalId('slack', 'T1');
    expect(workspace).toBeDefined();
    store.upsertBotInstallation({
      workspaceId: workspace!.id,
      provider: 'slack',
      externalWorkspaceId: workspace!.externalWorkspaceId,
      role: 'personal',
      botUserId: 'UPERSONALBOT',
      representedUserId: 'UOWNER'
    });

    const response = await request('GET', '/api/setup/status');

    expect(response.status).toBe(200);
    expect(response.body.slack.roles.channel.installed).toBe(true);
    expect(response.body.slack.roles.personal.installed).toBe(false);
    expect(response.body.slack.roles.personal.representedOwnerConfigured).toBe(true);
  });

  it('prefers the readable Slack channel install over an older stale install', async () => {
    const { request, store } = await setup({ skipSlackToken: true });
    const { writeSecret } = await import('../../shared/server/credentials/local-store');
    const readableWorkspace = store.saveInstall({
      provider: 'slack',
      externalWorkspaceId: 'T-readable',
      name: 'Readable Workspace',
      botUserId: 'UREADABLEBOT'
    });
    const readableInstallation = store.getBotInstallation('slack', 'T-readable', 'channel');
    writeSecret('slack', 'bot_token', 'xoxb-readable', {
      workspaceId: readableWorkspace.id,
      externalWorkspaceId: readableWorkspace.externalWorkspaceId,
      botInstallationId: readableInstallation?.id
    });

    const response = await request('GET', '/api/setup/status');

    expect(response.status).toBe(200);
    expect(response.body.slack.installed).toBe(true);
    expect(response.body.slack.roles.channel.installed).toBe(true);
    expect(response.body.slack.roles.channel.workspace).toEqual(expect.objectContaining({
      externalWorkspaceId: 'T-readable',
      name: 'Readable Workspace'
    }));
  });

  it('returns role-specific setup helper links in setup status', async () => {
    const { request } = await setup();
    await request('POST', '/api/setup/config', {
      SLACK_CHANNEL_APP_ID: 'A-channel',
      SLACK_PERSONAL_APP_ID: 'A-personal',
      DISCORD_CHANNEL_CLIENT_ID: 'discord-channel-client',
      DISCORD_PERSONAL_CLIENT_ID: 'discord-personal-client'
    });

    const response = await request('GET', '/api/setup/status');

    expect(response.status).toBe(200);
    expect(response.body.slack.roles.channel.links).toEqual(expect.objectContaining({
      appId: 'A-channel',
      callbackUrl: 'http://localhost/api/slack/oauth/callback',
      manifestUrl: '/slack-channel-manifest.yaml',
      appConfigUrl: 'https://api.slack.com/apps/A-channel/general',
      oauthConfigUrl: 'https://api.slack.com/apps/A-channel/oauth',
      eventsConfigUrl: 'https://api.slack.com/apps/A-channel/event-subscriptions'
    }));
    expect(response.body.slack.roles.personal.links).toEqual(expect.objectContaining({
      appId: 'A-personal',
      manifestUrl: '/slack-personal-manifest.yaml',
      appConfigUrl: 'https://api.slack.com/apps/A-personal/general'
    }));
    expect(response.body.discord.roles.channel.links).toEqual(expect.objectContaining({
      redirectUri: 'http://localhost/api/discord/oauth/callback',
      developerPortalUrl: 'https://discord.com/developers/applications/discord-channel-client/oauth2',
      botConfigUrl: 'https://discord.com/developers/applications/discord-channel-client/bot'
    }));
    expect(response.body.discord.roles.personal.links).toEqual(expect.objectContaining({
      developerPortalUrl: 'https://discord.com/developers/applications/discord-personal-client/oauth2',
      botConfigUrl: 'https://discord.com/developers/applications/discord-personal-client/bot'
    }));
  });

  it('reports bot installations in setup status independently of product mode', async () => {
    const { request } = await setup({ productMode: 'personal' });

    const response = await request('GET', '/api/setup/status');

    expect(response.status).toBe(200);
    expect(response.body.productMode).toBe('personal');
    expect(response.body.botInstallations).toEqual(expect.arrayContaining([
      expect.objectContaining({ provider: 'slack', role: 'channel', externalWorkspaceId: 'T1' })
    ]));
  });

  it('saves provider-specific bot role toggles including an all-off provider', async () => {
    const { request } = await setup();

    const update = await request('PUT', '/api/setup/provider-roles', {
      providerBotRoles: {
        slack: [],
        discord: ['personal']
      }
    });

    expect(update.status).toBe(200);
    expect(update.body.providerBotRoles).toEqual({
      slack: [],
      discord: ['personal']
    });

    const status = await request('GET', '/api/setup/status');
    expect(status.status).toBe(200);
    expect(status.body.botRoles).toEqual(['channel']);
    expect(status.body.providerBotRoles).toEqual({
      slack: [],
      discord: []
    });
  });

  it('prepares a Slack channel app from the channel manifest and saves returned credentials', async () => {
    process.env.MURPH_SLACK_API_BASE = 'https://slack.test/api';
    const { request } = await setup();
    const calls: Array<{ url: string; body?: Record<string, unknown> }> = [];
    vi.stubGlobal('fetch', async (url: string, options: RequestInit = {}) => {
      const body = options.body ? JSON.parse(String(options.body)) : undefined;
      calls.push({ url: String(url), body });
      return Response.json({
        ok: true,
        app_id: 'A-channel',
        credentials: {
          client_id: 'channel-client-id',
          client_secret: 'channel-client-secret',
          signing_secret: 'channel-signing-secret',
          app_token: 'xapp-channel'
        },
        team_id: 'T-channel',
        team_name: 'Channel Workspace'
      });
    });

    const response = await request('POST', '/api/setup/slack/prepare', {
      role: 'channel',
      configurationToken: 'xoxe-config'
    });

    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(response.body).toEqual(expect.objectContaining({
      ok: true,
      role: 'channel',
      appId: 'A-channel',
      clientId: 'channel-client-id',
      appTokenConfigured: true,
      callbackUrl: 'http://localhost/api/slack/oauth/callback',
      installUrl: '/api/slack/channel/install?source=setup'
    }));
    const manifestCall = calls.find((call) => call.url.includes('/apps.manifest.create'));
    expect(manifestCall).toBeTruthy();
    const manifestBody = JSON.parse(String(manifestCall?.body?.manifest));
    expect(manifestBody.oauth_config.redirect_urls).toEqual(['http://localhost/api/slack/oauth/callback']);
    expect(manifestBody.oauth_config.scopes.bot).toEqual(expect.arrayContaining(['app_mentions:read', 'channels:history']));
    expect(manifestBody.oauth_config.scopes.bot).toContain('commands');
    expect(manifestBody.features.slash_commands[0]).toEqual(expect.objectContaining({
      command: '/murph'
    }));
    expect(manifestBody.features.slash_commands[0]).not.toHaveProperty('url');
    expect(manifestBody.features.shortcuts[0]).toEqual(expect.objectContaining({
      callback_id: 'murph_personal_handoff'
    }));
    expect(manifestBody.settings.interactivity).toEqual(expect.objectContaining({
      is_enabled: true
    }));
    expect(manifestBody.settings.interactivity).not.toHaveProperty('request_url');
    expect(manifestBody.settings.socket_mode_enabled).toBe(true);
    expect(readFileSync(process.env.MURPH_CONFIG_PATH!, 'utf8')).toContain('appId: A-channel');
    const { readSecret } = await import('../../shared/server/credentials/local-store');
    expect(readSecret('slack', 'channel_client_secret')).toBe('channel-client-secret');
    expect(readSecret('slack', 'client_secret')).toBe('channel-client-secret');
    expect(readSecret('slack', 'channel_app_token')).toBe('xapp-channel');
  });

  it('prepares a Slack personal app from the personal manifest without writing legacy channel keys', async () => {
    process.env.MURPH_SLACK_API_BASE = 'https://slack.test/api';
    const { request } = await setup();
    const calls: Array<{ url: string; body?: Record<string, unknown> }> = [];
    vi.stubGlobal('fetch', async (url: string, options: RequestInit = {}) => {
      const body = options.body ? JSON.parse(String(options.body)) : undefined;
      calls.push({ url: String(url), body });
      return Response.json({
        ok: true,
        app_id: 'A-personal',
        credentials: {
          client_id: 'personal-client-id',
          client_secret: 'personal-client-secret',
          signing_secret: 'personal-signing-secret'
        }
      });
    });

    const response = await request('POST', '/api/setup/slack/prepare', {
      role: 'personal',
      configurationToken: 'xoxe-config'
    });

    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(response.body).toEqual(expect.objectContaining({
      ok: true,
      role: 'personal',
      appId: 'A-personal',
      clientId: 'personal-client-id',
      appTokenConfigured: false,
      installUrl: '/api/slack/personal/install?source=setup'
    }));
    const manifestCall = calls.find((call) => call.url.includes('/apps.manifest.create'));
    const manifestBody = JSON.parse(String(manifestCall?.body?.manifest));
    expect(manifestBody.display_information.name).toBe('Murph Personal');
    expect(manifestBody.oauth_config.scopes.bot).toEqual(['chat:write', 'im:history', 'im:write']);
    expect(manifestBody.oauth_config.scopes.user).toBeUndefined();
    const config = readFileSync(process.env.MURPH_CONFIG_PATH!, 'utf8');
    expect(config).toContain('personal:');
    expect(config).toContain('appId: A-personal');
    expect(config).not.toContain('appId: A-channel');
    const { readSecret } = await import('../../shared/server/credentials/local-store');
    expect(readSecret('slack', 'personal_client_secret')).toBe('personal-client-secret');
    expect(readSecret('slack', 'client_secret')).toBeUndefined();
  });

  it('creates a new Slack app from prepare even when a saved Slack app ID exists', async () => {
    process.env.MURPH_SLACK_API_BASE = 'https://slack.test/api';
    const { request } = await setup();
    await request('POST', '/api/setup/config', {
      SLACK_CHANNEL_APP_ID: 'A-existing'
    });
    const calls: Array<{ url: string; body?: Record<string, unknown> }> = [];
    vi.stubGlobal('fetch', async (url: string, options: RequestInit = {}) => {
      const body = options.body ? JSON.parse(String(options.body)) : undefined;
      calls.push({ url: String(url), body });
      return Response.json({
        ok: true,
        app_id: 'A-new',
        credentials: {
          client_id: 'new-client-id',
          client_secret: 'new-client-secret'
        }
      });
    });

    const response = await request('POST', '/api/setup/slack/prepare', {
      role: 'channel',
      configurationToken: 'xoxe-config'
    });

    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(response.body.updatedExistingApp).toBe(false);
    expect(response.body.appId).toBe('A-new');
    expect(calls.some((call) => call.url.includes('/apps.manifest.export'))).toBe(false);
    expect(calls.some((call) => call.url.includes('/apps.manifest.update'))).toBe(false);
    expect(calls.some((call) => call.url.includes('/apps.manifest.create'))).toBe(true);
  });

  it('ignores explicitly provided existing Slack app IDs in the creation route', async () => {
    process.env.MURPH_SLACK_API_BASE = 'https://slack.test/api';
    const { request } = await setup();
    const calls: Array<{ url: string; body?: Record<string, unknown> }> = [];
    vi.stubGlobal('fetch', async (url: string, options: RequestInit = {}) => {
      const body = options.body ? JSON.parse(String(options.body)) : undefined;
      calls.push({ url: String(url), body });
      return Response.json({
        ok: true,
        app_id: 'A-created',
        credentials: {
          client_id: 'created-client-id',
          client_secret: 'created-client-secret'
        }
      });
    });

    const response = await request('POST', '/api/setup/slack/prepare', {
      role: 'channel',
      configurationToken: 'xoxe-config',
      existingAppId: 'A-provided'
    });

    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(response.body.updatedExistingApp).toBe(false);
    expect(response.body.appId).toBe('A-created');
    expect(calls.some((call) => call.url.includes('/apps.manifest.export'))).toBe(false);
    expect(calls.some((call) => call.url.includes('/apps.manifest.update'))).toBe(false);
    expect(calls.some((call) => call.url.includes('/apps.manifest.create'))).toBe(true);
  });

  it('stores manual Slack channel app values for existing app reuse', async () => {
    const { request } = await setup();

    const response = await request('POST', '/api/setup/config', {
      SLACK_CHANNEL_APP_ID: 'A-existing',
      SLACK_CHANNEL_APP_TOKEN: 'xapp-existing',
      SLACK_CHANNEL_CLIENT_ID: 'existing-client-id',
      SLACK_CHANNEL_CLIENT_SECRET: 'existing-client-secret',
      SLACK_CHANNEL_SIGNING_SECRET: 'existing-signing-secret',
      SLACK_APP_ID: 'A-existing',
      SLACK_APP_TOKEN: 'xapp-existing',
      SLACK_CLIENT_ID: 'existing-client-id',
      SLACK_CLIENT_SECRET: 'existing-client-secret',
      SLACK_SIGNING_SECRET: 'existing-signing-secret'
    });

    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(readFileSync(process.env.MURPH_CONFIG_PATH!, 'utf8')).toContain('appId: A-existing');
    const { readSecret } = await import('../../shared/server/credentials/local-store');
    expect(readSecret('slack', 'channel_app_token')).toBe('xapp-existing');
    expect(readSecret('slack', 'app_token')).toBe('xapp-existing');
    expect(readSecret('slack', 'channel_client_secret')).toBe('existing-client-secret');
    expect(readSecret('slack', 'client_secret')).toBe('existing-client-secret');
  });

  it('stores manual Slack personal app values for existing app reuse without legacy channel keys', async () => {
    const { request } = await setup();

    const response = await request('POST', '/api/setup/config', {
      SLACK_PERSONAL_APP_ID: 'A-personal-existing',
      SLACK_PERSONAL_APP_TOKEN: 'xapp-personal-existing',
      SLACK_PERSONAL_CLIENT_ID: 'personal-existing-client-id',
      SLACK_PERSONAL_CLIENT_SECRET: 'personal-existing-client-secret',
      SLACK_PERSONAL_SIGNING_SECRET: 'personal-existing-signing-secret'
    });

    expect(response.status, JSON.stringify(response.body)).toBe(200);
    const config = readFileSync(process.env.MURPH_CONFIG_PATH!, 'utf8');
    expect(config).toContain('personal:');
    expect(config).toContain('appId: A-personal-existing');
    expect(config).not.toContain('appId: A-channel-existing');
    const { readSecret } = await import('../../shared/server/credentials/local-store');
    expect(readSecret('slack', 'personal_app_token')).toBe('xapp-personal-existing');
    expect(readSecret('slack', 'app_token')).toBeUndefined();
    expect(readSecret('slack', 'personal_client_secret')).toBe('personal-existing-client-secret');
    expect(readSecret('slack', 'client_secret')).toBeUndefined();
  });

  it('does not send pasted Slack app-level tokens to Manifest APIs from UI setup', async () => {
    const { request } = await setup();
    const calls: string[] = [];
    vi.stubGlobal('fetch', async (url: string) => {
      calls.push(String(url));
      return Response.json({ ok: false, error: 'should_not_be_called' }, { status: 500 });
    });

    const response = await request('POST', '/api/setup/slack/prepare', {
      role: 'channel',
      configurationToken: 'xapp-mistaken'
    });

    expect(response.status).toBe(400);
    expect(response.body.error).toContain('app-level token');
    expect(calls).toEqual([]);
    const { readSecret } = await import('../../shared/server/credentials/local-store');
    expect(readSecret('slack', 'channel_app_token')).toBe('xapp-mistaken');
    expect(readSecret('slack', 'app_token')).toBe('xapp-mistaken');
  });

  it('surfaces Slack manifest create failures without trying existing-app lookup', async () => {
    process.env.MURPH_SLACK_API_BASE = 'https://slack.test/api';
    const { request } = await setup();
    await request('POST', '/api/setup/config', {
      SLACK_CHANNEL_APP_ID: 'A-existing'
    });
    const calls: string[] = [];
    vi.stubGlobal('fetch', async (url: string) => {
      calls.push(String(url));
      return Response.json({ ok: false, error: 'ratelimited' });
    });

    const response = await request('POST', '/api/setup/slack/prepare', {
      role: 'channel',
      configurationToken: 'xoxe-config'
    });

    expect(response.status).toBe(400);
    expect(response.body.error).toContain('ratelimited');
    expect(calls.some((url) => url.includes('/apps.manifest.export'))).toBe(false);
    expect(calls.some((url) => url.includes('/apps.manifest.update'))).toBe(false);
    expect(calls.some((url) => url.includes('/apps.manifest.create'))).toBe(true);
  });

  it('constrains MURPH_BOT_ROLES to the active team distribution in setup status', async () => {
    const { request } = await setup({ botRolesEnv: 'personal' });

    const response = await request('GET', '/api/setup/status');

    expect(response.status).toBe(200);
    expect(response.body.botRoles).toEqual(['channel']);
    expect(response.body.roleStatus.channel.selected).toBe(true);
    expect(response.body.roleStatus.personal.selected).toBe(false);
  });

  it('uses personal bot roles in the personal distribution', async () => {
    const { request } = await setup({ productMode: 'personal', botRolesEnv: 'personal' });

    const response = await request('GET', '/api/setup/status');

    expect(response.status).toBe(200);
    expect(response.body.productMode).toBe('personal');
    expect(response.body.botRoles).toEqual(['personal']);
    expect(response.body.roleStatus.channel.selected).toBe(false);
    expect(response.body.roleStatus.personal.selected).toBe(true);
  });

  it('constrains config-backed bot roles to the active team distribution', async () => {
    const { request } = await setup();
    const { updateMurphSetupDefaults } = await import('../../shared/server/setup/config-file');
    updateMurphSetupDefaults({ botRoles: ['channel', 'personal'] });

    const response = await request('GET', '/api/setup/status');

    expect(response.status).toBe(200);
    expect(response.body.botRoles).toEqual(['channel']);
    expect(response.body.roleStatus.channel.selected).toBe(true);
    expect(response.body.roleStatus.personal.selected).toBe(false);
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

  it('prepares Discord setup by validating the bot, deriving the client ID, and checking redirect URI', async () => {
    const { request } = await setup();
    const calls: Array<{ url: string; method: string; body?: Record<string, unknown> }> = [];
    vi.stubGlobal('fetch', async (url: string, options: RequestInit = {}) => {
      const body = options.body ? JSON.parse(String(options.body)) : undefined;
      calls.push({ url: String(url), method: options.method ?? 'GET', body });
      if (String(url).includes('/users/@me')) {
        return Response.json({ id: 'bot-123', username: 'murphbot', global_name: 'Murph Bot' });
      }
      if (String(url).includes('/oauth2/applications/@me')) {
        return Response.json({
          id: 'app-123',
          name: 'Murph',
          flags: 4,
          redirect_uris: ['http://localhost/api/discord/oauth/callback']
        });
      }
      if (String(url).includes('/applications/@me') && options.method === 'PATCH') {
        return Response.json({ ok: true });
      }
      return Response.json({});
    });

    const response = await request('POST', '/api/setup/discord/prepare', {
      botToken: 'discord-bot-token',
      clientSecret: 'discord-client-secret'
    });

    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(response.body).toEqual(expect.objectContaining({
      ok: true,
      botUserId: 'bot-123',
      botName: 'Murph Bot',
      applicationId: 'app-123',
      redirectUri: 'http://localhost/api/discord/oauth/callback',
      developerPortalUrl: 'https://discord.com/developers/applications/app-123/oauth2',
      redirectUriRegistered: true,
      permissionsConfigured: true,
      intentsConfigured: true,
      installUrl: '/api/discord/channel/install?source=setup'
    }));
    const patch = calls.find((call) => call.url.includes('/applications/@me') && call.method === 'PATCH');
    expect(patch?.body).toEqual(expect.objectContaining({
      install_params: expect.objectContaining({ scopes: ['bot'] }),
      flags: 524292
    }));
    const config = readFileSync(process.env.MURPH_CONFIG_PATH!, 'utf8');
    expect(config).toContain('clientId: app-123');
    const { readSecret } = await import('../../shared/server/credentials/local-store');
    expect(readSecret('discord', 'bot_token')).toBe('discord-bot-token');
    expect(readSecret('discord', 'client_secret')).toBe('discord-client-secret');
  });

  it('rejects manual owner changes for OAuth-owned channel workspaces', async () => {
    const { request, workspace } = await setup();
    await seedWorkspaceOwner(workspace, 'U1', 'Daniel');

    const response = await request('PUT', '/api/setup/defaults', {
      ownerUserId: 'U2',
      ownerDisplayName: 'Someone Else'
    });

    expect(response.status).toBe(400);
    expect(response.body).toEqual(expect.objectContaining({
      ok: false,
      error: 'owner_identity_mismatch',
      owner: expect.objectContaining({ ownerUserId: 'U1' })
    }));
  });

  it('does not expose member enumeration for OAuth-owned channel workspaces', async () => {
    const { request, workspace } = await setup();

    const response = await request('GET', `/api/setup/members?workspaceId=${workspace.id}`);

    expect(response.status).toBe(410);
    expect(response.body).toEqual({ ok: false, error: 'owner_identity_locked', members: [] });
  });

  it('reports Discord redirect URI and app automation failures without blocking preparation', async () => {
    const { request } = await setup();
    vi.stubGlobal('fetch', async (url: string, options: RequestInit = {}) => {
      if (String(url).includes('/users/@me')) {
        return Response.json({ id: 'bot-123', username: 'murphbot' });
      }
      if (String(url).includes('/oauth2/applications/@me')) {
        return Response.json({
          id: 'app-123',
          redirect_uris: ['http://localhost/other/callback']
        });
      }
      if (String(url).includes('/applications/@me') && options.method === 'PATCH') {
        return Response.json({ message: 'Missing Access' }, { status: 403 });
      }
      return Response.json({});
    });

    const response = await request('POST', '/api/setup/discord/prepare', {
      botToken: 'discord-bot-token',
      clientSecret: 'discord-client-secret'
    });

    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(response.body).toEqual(expect.objectContaining({
      ok: true,
      redirectUriRegistered: false,
      permissionsConfigured: false,
      intentsConfigured: false,
      configurationError: 'Discord app configuration automation failed: Missing Access'
    }));
  });

  it('treats workspace-scoped Discord bot credentials as configured', async () => {
    const { request, store } = await setup();
    const { writeSecret } = await import('../../shared/server/credentials/local-store');
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

  it('does not mark Discord connected from install rows without credentials', async () => {
    const { request, store } = await setup();
    const discordWorkspace = store.saveInstall({
      provider: 'discord',
      externalWorkspaceId: 'G1',
      name: 'Test Server',
      botUserId: 'bot-user-1'
    });
    store.upsertBotInstallation({
      workspaceId: discordWorkspace.id,
      provider: 'discord',
      role: 'personal',
      externalWorkspaceId: 'personal:U1',
      botUserId: 'personal-bot-user',
      representedUserId: 'U1'
    });

    const response = await request('GET', '/api/setup/status');

    expect(response.status).toBe(200);
    expect(response.body.discord.installed).toBe(false);
    expect(response.body.discord.botTokenConfigured).toBe(false);
    expect(response.body.discord.roles.channel.installed).toBe(false);
    expect(response.body.discord.roles.personal.installed).toBe(false);
    expect(response.body.discord.roles.personal.representedOwnerConfigured).toBe(true);
  });

  it('does not use Discord channel credentials to mark the personal bot connected', async () => {
    const { request, store } = await setup();
    const { writeSecret } = await import('../../shared/server/credentials/local-store');
    const discordWorkspace = store.saveInstall({
      provider: 'discord',
      externalWorkspaceId: 'G1',
      name: 'Test Server',
      botUserId: 'channel-bot-user'
    });
    store.upsertBotInstallation({
      workspaceId: discordWorkspace.id,
      provider: 'discord',
      role: 'personal',
      externalWorkspaceId: 'personal:U1',
      botUserId: 'personal-bot-user',
      representedUserId: 'U1'
    });
    writeSecret('discord', 'channel_bot_token', 'discord-channel-token');

    const response = await request('GET', '/api/setup/status');

    expect(response.status).toBe(200);
    expect(response.body.discord.installed).toBe(true);
    expect(response.body.discord.roles.channel.installed).toBe(true);
    expect(response.body.discord.roles.personal.installed).toBe(false);
  });

  it('marks only the Discord personal bot connected when only personal credentials are present', async () => {
    const { request, store } = await setup();
    const { writeSecret } = await import('../../shared/server/credentials/local-store');
    const personalWorkspace = store.saveInstall({
      provider: 'discord',
      externalWorkspaceId: 'personal:U1',
      name: 'Personal User',
      botUserId: 'personal-bot-user',
      role: 'personal',
      representedUserId: 'U1'
    });
    const personalInstallation = store.getBotInstallation('discord', personalWorkspace.externalWorkspaceId, 'personal');
    writeSecret('discord', 'bot_token', 'discord-personal-token', {
      workspaceId: personalWorkspace.id,
      externalWorkspaceId: personalWorkspace.externalWorkspaceId,
      botInstallationId: personalInstallation?.id
    });

    const response = await request('GET', '/api/setup/status');

    expect(response.status).toBe(200);
    expect(response.body.discord.installed).toBe(true);
    expect(response.body.discord.roles.channel.installed).toBe(false);
    expect(response.body.discord.roles.personal.installed).toBe(true);
  });

  it('stores Google OAuth client settings through setup config', async () => {
    const { request } = await setup();

    const response = await request('POST', '/api/setup/config', {
      GOOGLE_CLIENT_ID: 'google-client-id',
      GOOGLE_CLIENT_SECRET: 'google-client-secret'
    });
    const { getRuntimeEnv } = await import('#shared/server/util/env');

    expect(response.status).toBe(200);
    expect(response.body.updated).toEqual(expect.arrayContaining(['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET']));
    expect(readFileSync(process.env.MURPH_CONFIG_PATH!, 'utf8')).toContain('clientId: google-client-id');
    expect(getRuntimeEnv().googleClientId).toBe('google-client-id');
    expect(getRuntimeEnv().googleClientSecret).toBe('google-client-secret');
  });
});
