import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

const repoRoot = process.cwd();
const setupCli = path.join(repoRoot, 'bin/setup-cli.mjs');

function createAppDir(): string {
  const appDir = path.join(tmpdir(), `murph-setup-cli-discord-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  mkdirSync(appDir, { recursive: true });
  return appDir;
}

function createFakeMurphBin(appDir: string): string {
  const binDir = path.join(appDir, 'bin');
  const callsPath = path.join(appDir, 'murph-calls.jsonl');
  mkdirSync(binDir, { recursive: true });
  const binPath = path.join(binDir, 'murph');
  writeFileSync(binPath, `#!/usr/bin/env bash
set -euo pipefail
printf '%s\\n' "$*" >> "${callsPath}"
`);
  chmodSync(binPath, 0o755);
  return callsPath;
}

function createFetchMock(
  appDir: string,
  setupStatuses: unknown[] = [
    { ok: true, discord: { installed: true, botTokenConfigured: true, clientIdConfigured: true, clientSecretConfigured: true, ownerConfigured: true, workspace: { id: 'ws-discord', externalWorkspaceId: 'guild-1', name: 'Murph Guild' } } }
  ]
): { callsPath: string; mockPath: string; setupStatusesPath: string } {
  const callsPath = path.join(appDir, 'fetch-calls.jsonl');
  const setupStatusesPath = path.join(appDir, 'setup-status-payloads.json');
  const mockPath = path.join(appDir, 'mock-fetch.mjs');
  writeFileSync(setupStatusesPath, JSON.stringify(setupStatuses));
  writeFileSync(mockPath, `
import { appendFileSync, readFileSync } from 'node:fs';

const callsPath = process.env.MOCK_FETCH_CALLS;
const setupStatusPayloads = JSON.parse(readFileSync(process.env.MOCK_SETUP_STATUSES, 'utf8'));
let setupStatusIndex = 0;
let discordGuildSaveAttempts = 0;
let discordApplicationFetches = 0;

globalThis.fetch = async (url, options = {}) => {
  const body = options.body ? JSON.parse(String(options.body)) : undefined;
  appendFileSync(callsPath, JSON.stringify({
    url: String(url),
    method: options.method || 'GET',
    body,
    authorization: options.headers?.authorization
  }) + '\\n');
  if (String(url).includes('/users/@me/guilds')) {
    return Response.json(JSON.parse(process.env.MOCK_DISCORD_GUILDS || '[{"id":"guild-direct","name":"Direct Guild"}]'));
  }
  if (String(url).includes('/guilds/') && String(url).includes('/members/')) {
    const userId = String(url).split('/members/')[1]?.split(/[?#]/)[0] || 'user-1';
    return Response.json({
      user: { id: userId, username: 'daniel', global_name: 'Daniel Lee' },
      nick: process.env.MOCK_DISCORD_MEMBER_NICK || null
    });
  }
  if (String(url).includes('/guilds/')) {
    if (process.env.MOCK_DISCORD_GUILD_FETCH_FAIL === '1') {
      return Response.json({ message: 'Unknown Guild' }, { status: 404 });
    }
    const guildId = String(url).split('/guilds/')[1]?.split(/[?#]/)[0] || 'guild-manual';
    return Response.json({
      id: guildId,
      name: guildId === 'guild-manual' ? 'Manual Guild' : guildId === 'guild-direct' ? 'Direct Guild' : 'Discord Guild'
    });
  }
  if (String(url).includes('/users/@me')) {
    return Response.json({ id: 'bot-user-1', username: 'murph-bot', bot: true });
  }
  if (String(url).includes('/oauth2/applications/@me')) {
    discordApplicationFetches += 1;
    const redirectUris = discordApplicationFetches > 1 && process.env.MOCK_DISCORD_REDIRECT_URIS_AFTER_FIRST
      ? JSON.parse(process.env.MOCK_DISCORD_REDIRECT_URIS_AFTER_FIRST)
      : process.env.MOCK_DISCORD_REDIRECT_URIS
        ? JSON.parse(process.env.MOCK_DISCORD_REDIRECT_URIS)
        : undefined;
    return Response.json({
      id: 'app-123',
      name: 'Murph',
      flags: 0,
      ...(redirectUris === undefined ? {} : { redirect_uris: redirectUris })
    });
  }
  if (String(url).includes('/applications/@me')) {
    if (process.env.MOCK_DISCORD_APP_CONFIG_FAIL === '1') {
      return Response.json({ message: 'Missing Access' }, { status: 403 });
    }
    return Response.json({ id: 'app-123' });
  }
  if (String(url).includes('/api/health')) {
    return Response.json({ ok: true });
  }
  if (String(url).includes('/api/setup/config')) {
    return Response.json({ ok: true, updated: [] });
  }
  if (String(url).includes('/api/setup/status')) {
    const payload = setupStatusPayloads[Math.min(setupStatusIndex, setupStatusPayloads.length - 1)];
    setupStatusIndex += 1;
    return Response.json(payload);
  }
  if (String(url).includes('/api/setup/channels')) {
    if (process.env.MOCK_SETUP_CHANNELS_FAIL === '1') {
      return Response.json({ ok: false, error: 'Failed to fetch Discord channels: Missing Access' }, { status: 500 });
    }
    return Response.json({
      ok: true,
      channels: JSON.parse(process.env.MOCK_SETUP_CHANNELS || '[{"id":"channel-1","displayName":"#general","isPrivate":false,"isMember":true}]')
    });
  }
  if (String(url).includes('/api/setup/channel')) {
    const parsed = new URL(String(url));
    const channelId = parsed.searchParams.get('channelId') || 'channel-1';
    if (process.env.MOCK_SETUP_CHANNEL_INVALID === channelId) {
      return Response.json({ ok: false, error: 'Failed to fetch Discord channel: Unknown Channel' }, { status: 500 });
    }
    return Response.json({ ok: true, channel: { id: channelId, displayName: channelId === 'channel-2' ? '#launch' : '#general' } });
  }
  if (String(url).includes('/api/setup/defaults')) {
    return Response.json({ ok: true, defaults: body || JSON.parse(process.env.MOCK_SETUP_DEFAULTS || '{}') });
  }
  if (String(url).includes('/api/setup/members')) {
    if (process.env.MOCK_SETUP_MEMBERS_FAIL === '1') {
      return Response.json({ ok: false, error: 'Failed to fetch Discord members: Missing Access' }, { status: 500 });
    }
    return Response.json({ ok: true, members: JSON.parse(process.env.MOCK_SETUP_MEMBERS || '[]') });
  }
  if (String(url).includes('/api/setup/member')) {
    const parsed = new URL(String(url));
    const userId = parsed.searchParams.get('userId') || 'user-1';
    return Response.json({ ok: true, member: { id: userId, displayName: 'Daniel Lee' } });
  }
  if (String(url).includes('/api/discord/guilds')) {
    return Response.json({ ok: true, guilds: [{ id: 'guild-rest', name: 'REST Guild' }] });
  }
  if (String(url).includes('/api/discord/guild')) {
    discordGuildSaveAttempts += 1;
    if (
      process.env.MOCK_DISCORD_GUILD_SAVE_NOT_FOUND === 'always' ||
      (process.env.MOCK_DISCORD_GUILD_SAVE_NOT_FOUND === 'once' && discordGuildSaveAttempts === 1)
    ) {
      return Response.json({ ok: false, error: 'not_found' }, { status: 404 });
    }
    const guildId = options.body ? JSON.parse(String(options.body)).guildId : 'guild-manual';
    return Response.json({
      ok: true,
      workspace: {
        id: guildId === 'guild-rest' ? 'ws-rest' : guildId === 'guild-direct' ? 'ws-direct' : 'ws-manual',
        externalWorkspaceId: guildId,
        name: guildId === 'guild-rest' ? 'REST Guild' : guildId === 'guild-direct' ? 'Direct Guild' : 'Manual Guild'
      }
    });
  }
  return Response.json({ ok: false, error: 'not_found' }, { status: 404 });
};
`);
  return { callsPath, mockPath, setupStatusesPath };
}

function readCalls(callsPath: string): Array<{ url: string; method: string; body?: Record<string, unknown>; authorization?: string }> {
  if (!existsSync(callsPath)) return [];
  return readFileSync(callsPath, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

describe('setup CLI Discord setup', () => {
  it('derives client ID from a bot token and records the detected guild', () => {
    const appDir = createAppDir();
    const { callsPath, mockPath, setupStatusesPath } = createFetchMock(appDir);
    const result = spawnSync(process.execPath, ['--import', mockPath, setupCli, 'discord'], {
      cwd: repoRoot,
      input: '\n\n',
      env: {
        ...process.env,
        MURPH_APP_DIR: appDir,
        MURPH_CONFIG_PATH: path.join(appDir, 'config.yaml'),
        MURPH_CREDENTIALS_PATH: path.join(appDir, '.credentials'),
        MURPH_URL: 'http://murph.test',
        MURPH_DISCORD_API_BASE: 'http://discord.test/api/v10',
        DISCORD_BOT_TOKEN: 'discord-bot-token',
        DISCORD_CLIENT_SECRET: 'discord-client-secret',
        MOCK_FETCH_CALLS: callsPath,
        MOCK_SETUP_STATUSES: setupStatusesPath,
        PATH: '/usr/bin:/bin'
      },
      encoding: 'utf8'
    });

    expect(result.status, result.stderr + result.stdout).toBe(0);
    expect(result.stdout).toContain('Murph Guild is connected.');

    const config = readFileSync(path.join(appDir, 'config.yaml'), 'utf8');
    expect(config).toContain('clientId: app-123');
    expect(config).toContain('channelProvider: discord');
    expect(config).toContain('workspaceId: ws-discord');

    const credentials = JSON.parse(readFileSync(path.join(appDir, '.credentials'), 'utf8'));
    expect(credentials.credentials).toEqual(expect.arrayContaining([
      expect.objectContaining({ provider: 'discord', key: 'bot_token', value: 'discord-bot-token' }),
      expect.objectContaining({ provider: 'discord', key: 'client_secret', value: 'discord-client-secret' })
    ]));

    const calls = readCalls(callsPath);
    expect(calls.find((call) => call.url.includes('/users/@me'))?.authorization).toBe('Bot discord-bot-token');
    expect(calls.some((call) => call.url.includes('/api/setup/config') && call.method === 'POST')).toBe(true);
    const appConfigCall = calls.find((call) => call.url.includes('/applications/@me') && call.method === 'PATCH');
    expect(appConfigCall?.body).toEqual(expect.objectContaining({
      install_params: {
        scopes: ['bot'],
        permissions: '274877991936'
      },
      integration_types_config: {
        0: {
          oauth2_install_params: {
            scopes: ['bot'],
            permissions: '274877991936'
          }
        }
      },
      flags: 524288
    }));
  });

  it('continues with manual guidance when Discord app configuration fails', () => {
    const appDir = createAppDir();
    const { callsPath, mockPath, setupStatusesPath } = createFetchMock(appDir);
    const result = spawnSync(process.execPath, ['--import', mockPath, setupCli, 'discord'], {
      cwd: repoRoot,
      input: '\n\n',
      env: {
        ...process.env,
        MURPH_APP_DIR: appDir,
        MURPH_CONFIG_PATH: path.join(appDir, 'config.yaml'),
        MURPH_CREDENTIALS_PATH: path.join(appDir, '.credentials'),
        MURPH_URL: 'http://murph.test',
        MURPH_DISCORD_API_BASE: 'http://discord.test/api/v10',
        DISCORD_BOT_TOKEN: 'discord-bot-token',
        DISCORD_CLIENT_SECRET: 'discord-client-secret',
        MOCK_DISCORD_APP_CONFIG_FAIL: '1',
        MOCK_FETCH_CALLS: callsPath,
        MOCK_SETUP_STATUSES: setupStatusesPath,
        PATH: '/usr/bin:/bin'
      },
      encoding: 'utf8'
    });

    expect(result.status, result.stderr + result.stdout).toBe(0);
    expect(result.stdout).toContain('Discord app configuration automation failed');
    expect(result.stdout).toContain('Message Content Intent');
    expect(result.stdout).toContain('Murph Guild is connected.');
  });

  it('falls back to manual guild ID when Discord REST does not return servers', () => {
    const appDir = createAppDir();
    const { callsPath, mockPath, setupStatusesPath } = createFetchMock(appDir, [
      { ok: true, discord: { installed: false, botTokenConfigured: true, clientIdConfigured: true } }
    ]);
    const result = spawnSync(process.execPath, ['--import', mockPath, setupCli, 'discord'], {
      cwd: repoRoot,
      input: '\n\n',
      env: {
        ...process.env,
        MURPH_APP_DIR: appDir,
        MURPH_CONFIG_PATH: path.join(appDir, 'config.yaml'),
        MURPH_CREDENTIALS_PATH: path.join(appDir, '.credentials'),
        MURPH_URL: 'http://murph.test',
        MURPH_DISCORD_API_BASE: 'http://discord.test/api/v10',
        MURPH_DISCORD_SKIP_INSTALL_CONFIRM: '1',
        MURPH_DISCORD_GUILD_ID: 'guild-manual',
        MOCK_DISCORD_GUILDS: '[]',
        DISCORD_BOT_TOKEN: 'discord-bot-token',
        DISCORD_CLIENT_SECRET: 'discord-client-secret',
        MOCK_FETCH_CALLS: callsPath,
        MOCK_SETUP_STATUSES: setupStatusesPath,
        PATH: '/usr/bin:/bin'
      },
      encoding: 'utf8'
    });

    expect(result.status, result.stderr + result.stdout).toBe(0);
    expect(result.stdout).toContain('http://murph.test/api/discord/install?source=setup');
    expect(result.stdout).toContain('Checking Discord servers for the installed bot...');
    expect(result.stdout).toContain('Manual Guild connected.');
    expect(readFileSync(path.join(appDir, 'config.yaml'), 'utf8')).toContain('workspaceId: ws-manual');

    const calls = readCalls(callsPath);
    const manualCall = calls.find((call) => call.url.includes('/api/discord/guild'));
    expect(manualCall?.body).toEqual({ guildId: 'guild-manual' });
  });

  it('continues when the Discord OAuth redirect URI is already registered', () => {
    const appDir = createAppDir();
    const { callsPath, mockPath, setupStatusesPath } = createFetchMock(appDir, [
      { ok: true, discord: { installed: false, botTokenConfigured: true, clientIdConfigured: true } }
    ]);
    const result = spawnSync(process.execPath, ['--import', mockPath, setupCli, 'discord'], {
      cwd: repoRoot,
      input: '\n\n',
      env: {
        ...process.env,
        MURPH_APP_DIR: appDir,
        MURPH_CONFIG_PATH: path.join(appDir, 'config.yaml'),
        MURPH_CREDENTIALS_PATH: path.join(appDir, '.credentials'),
        MURPH_URL: 'http://murph.test',
        MURPH_DISCORD_API_BASE: 'http://discord.test/api/v10',
        MURPH_DISCORD_SKIP_INSTALL_CONFIRM: '1',
        MURPH_DISCORD_GUILD_ID: 'guild-manual',
        MOCK_DISCORD_GUILDS: '[]',
        MOCK_DISCORD_REDIRECT_URIS: '["http://murph.test/api/discord/oauth/callback"]',
        DISCORD_BOT_TOKEN: 'discord-bot-token',
        DISCORD_CLIENT_SECRET: 'discord-client-secret',
        MOCK_FETCH_CALLS: callsPath,
        MOCK_SETUP_STATUSES: setupStatusesPath,
        PATH: '/usr/bin:/bin'
      },
      encoding: 'utf8'
    });

    expect(result.status, result.stderr + result.stdout).toBe(0);
    expect(result.stdout).toContain('Discord OAuth redirect URI is registered.');
    expect(result.stdout).toContain('Manual Guild connected.');
  });

  it('waits for a missing Discord OAuth redirect URI to be added before opening OAuth', () => {
    const appDir = createAppDir();
    const { callsPath, mockPath, setupStatusesPath } = createFetchMock(appDir, [
      { ok: true, discord: { installed: false, botTokenConfigured: true, clientIdConfigured: true } }
    ]);
    const result = spawnSync(process.execPath, ['--import', mockPath, setupCli, 'discord'], {
      cwd: repoRoot,
      input: '\n\n\n',
      env: {
        ...process.env,
        MURPH_APP_DIR: appDir,
        MURPH_CONFIG_PATH: path.join(appDir, 'config.yaml'),
        MURPH_CREDENTIALS_PATH: path.join(appDir, '.credentials'),
        MURPH_URL: 'http://murph.test',
        MURPH_DISCORD_API_BASE: 'http://discord.test/api/v10',
        MURPH_DISCORD_SKIP_INSTALL_CONFIRM: '1',
        MURPH_DISCORD_GUILD_ID: 'guild-manual',
        MOCK_DISCORD_GUILDS: '[]',
        MOCK_DISCORD_REDIRECT_URIS: '[]',
        MOCK_DISCORD_REDIRECT_URIS_AFTER_FIRST: '["http://murph.test/api/discord/oauth/callback"]',
        DISCORD_BOT_TOKEN: 'discord-bot-token',
        DISCORD_CLIENT_SECRET: 'discord-client-secret',
        MOCK_FETCH_CALLS: callsPath,
        MOCK_SETUP_STATUSES: setupStatusesPath,
        PATH: '/usr/bin:/bin'
      },
      encoding: 'utf8'
    });

    expect(result.status, result.stderr + result.stdout).toBe(0);
    expect(result.stdout).toContain('Discord OAuth redirect URI is not registered yet.');
    expect(result.stdout).toContain('http://murph.test/api/discord/oauth/callback');
    expect(result.stdout).toContain('https://discord.com/developers/applications/app-123/oauth2');
    expect(result.stdout).toContain('Discord OAuth redirect URI is registered.');
    expect(result.stdout).toContain('Manual Guild connected.');
  });

  it('fails non-interactively when Discord reports the OAuth redirect URI is missing', () => {
    const appDir = createAppDir();
    const { callsPath, mockPath, setupStatusesPath } = createFetchMock(appDir, [
      { ok: true, discord: { installed: false, botTokenConfigured: true, clientIdConfigured: true } }
    ]);
    const result = spawnSync(process.execPath, ['--import', mockPath, setupCli, 'discord', '--non-interactive'], {
      cwd: repoRoot,
      input: '',
      env: {
        ...process.env,
        MURPH_APP_DIR: appDir,
        MURPH_CONFIG_PATH: path.join(appDir, 'config.yaml'),
        MURPH_CREDENTIALS_PATH: path.join(appDir, '.credentials'),
        MURPH_URL: 'http://murph.test',
        MURPH_DISCORD_API_BASE: 'http://discord.test/api/v10',
        MOCK_DISCORD_REDIRECT_URIS: '[]',
        DISCORD_BOT_TOKEN: 'discord-bot-token',
        DISCORD_CLIENT_SECRET: 'discord-client-secret',
        MOCK_FETCH_CALLS: callsPath,
        MOCK_SETUP_STATUSES: setupStatusesPath,
        PATH: '/usr/bin:/bin'
      },
      encoding: 'utf8'
    });

    expect(result.status).toBe(1);
    expect(result.stderr + result.stdout).toContain('Missing Discord OAuth redirect URI');
    expect(result.stdout).not.toContain('Discord install URL');
    expect(readCalls(callsPath).some((call) => call.url.includes('/users/@me/guilds'))).toBe(false);
  });

  it('uses direct Discord REST discovery when one bot guild is available', () => {
    const appDir = createAppDir();
    const { callsPath, mockPath, setupStatusesPath } = createFetchMock(appDir, [
      { ok: true, discord: { installed: false, botTokenConfigured: true, clientIdConfigured: true } }
    ]);
    const result = spawnSync(process.execPath, ['--import', mockPath, setupCli, 'discord'], {
      cwd: repoRoot,
      input: '\n\n',
      env: {
        ...process.env,
        MURPH_APP_DIR: appDir,
        MURPH_CONFIG_PATH: path.join(appDir, 'config.yaml'),
        MURPH_CREDENTIALS_PATH: path.join(appDir, '.credentials'),
        MURPH_URL: 'http://murph.test',
        MURPH_DISCORD_API_BASE: 'http://discord.test/api/v10',
        MURPH_DISCORD_SKIP_INSTALL_CONFIRM: '1',
        MOCK_DISCORD_GUILDS: '[{"id":"guild-rest","name":"REST Guild"}]',
        DISCORD_BOT_TOKEN: 'discord-bot-token',
        DISCORD_CLIENT_SECRET: 'discord-client-secret',
        MOCK_FETCH_CALLS: callsPath,
        MOCK_SETUP_STATUSES: setupStatusesPath,
        PATH: '/usr/bin:/bin'
      },
      encoding: 'utf8'
    });

    expect(result.status, result.stderr + result.stdout).toBe(0);
    expect(result.stdout).toContain('REST Guild connected.');
    expect(readFileSync(path.join(appDir, 'config.yaml'), 'utf8')).toContain('workspaceId: ws-rest');

    const calls = readCalls(callsPath);
    const guildCall = calls.find((call) => call.url.includes('/api/discord/guild'));
    expect(guildCall?.body).toEqual({ guildId: 'guild-rest' });
  });

  it('uses configured guild ID when direct Discord REST discovery returns multiple guilds', () => {
    const appDir = createAppDir();
    const { callsPath, mockPath, setupStatusesPath } = createFetchMock(appDir, [
      { ok: true, discord: { installed: false, botTokenConfigured: true, clientIdConfigured: true } }
    ]);
    const result = spawnSync(process.execPath, ['--import', mockPath, setupCli, 'discord'], {
      cwd: repoRoot,
      input: '\n\n',
      env: {
        ...process.env,
        MURPH_APP_DIR: appDir,
        MURPH_CONFIG_PATH: path.join(appDir, 'config.yaml'),
        MURPH_CREDENTIALS_PATH: path.join(appDir, '.credentials'),
        MURPH_URL: 'http://murph.test',
        MURPH_DISCORD_API_BASE: 'http://discord.test/api/v10',
        MURPH_DISCORD_SKIP_INSTALL_CONFIRM: '1',
        MURPH_DISCORD_GUILD_ID: 'guild-direct',
        MOCK_DISCORD_GUILDS: '[{"id":"guild-one","name":"One"},{"id":"guild-direct","name":"Direct Guild"}]',
        DISCORD_BOT_TOKEN: 'discord-bot-token',
        DISCORD_CLIENT_SECRET: 'discord-client-secret',
        MOCK_FETCH_CALLS: callsPath,
        MOCK_SETUP_STATUSES: setupStatusesPath,
        PATH: '/usr/bin:/bin'
      },
      encoding: 'utf8'
    });

    expect(result.status, result.stderr + result.stdout).toBe(0);
    expect(result.stdout).toContain('Direct Guild connected.');

    const calls = readCalls(callsPath);
    expect(calls.some((call) => call.url.includes('/users/@me/guilds'))).toBe(true);
    const guildCall = calls.find((call) => call.url.includes('/api/discord/guild'));
    expect(guildCall?.body).toEqual({ guildId: 'guild-direct' });
  });

  it('restarts Murph and retries when the local Discord guild route is stale', () => {
    const appDir = createAppDir();
    const murphCallsPath = createFakeMurphBin(appDir);
    const { callsPath, mockPath, setupStatusesPath } = createFetchMock(appDir, [
      { ok: true, discord: { installed: false, botTokenConfigured: true, clientIdConfigured: true } }
    ]);
    const result = spawnSync(process.execPath, ['--import', mockPath, setupCli, 'discord'], {
      cwd: repoRoot,
      input: '\n\n',
      env: {
        ...process.env,
        MURPH_APP_DIR: appDir,
        MURPH_CONFIG_PATH: path.join(appDir, 'config.yaml'),
        MURPH_CREDENTIALS_PATH: path.join(appDir, '.credentials'),
        MURPH_URL: 'http://murph.test',
        MURPH_DISCORD_API_BASE: 'http://discord.test/api/v10',
        MURPH_DISCORD_SKIP_INSTALL_CONFIRM: '1',
        MOCK_DISCORD_GUILDS: '[{"id":"guild-rest","name":"REST Guild"}]',
        MOCK_DISCORD_GUILD_SAVE_NOT_FOUND: 'once',
        DISCORD_BOT_TOKEN: 'discord-bot-token',
        DISCORD_CLIENT_SECRET: 'discord-client-secret',
        MOCK_FETCH_CALLS: callsPath,
        MOCK_SETUP_STATUSES: setupStatusesPath,
        PATH: '/usr/bin:/bin'
      },
      encoding: 'utf8'
    });

    expect(result.status, result.stderr + result.stdout).toBe(0);
    expect(result.stdout).toContain('older setup API');
    expect(result.stdout).toContain('REST Guild connected.');
    expect(readFileSync(murphCallsPath, 'utf8')).toContain('restart');

    const guildCalls = readCalls(callsPath).filter((call) => call.url.includes('/api/discord/guild'));
    expect(guildCalls).toHaveLength(2);
  });

  it('reports a stale local build when the Discord guild route remains missing after restart', () => {
    const appDir = createAppDir();
    const murphCallsPath = createFakeMurphBin(appDir);
    const { callsPath, mockPath, setupStatusesPath } = createFetchMock(appDir, [
      { ok: true, discord: { installed: false, botTokenConfigured: true, clientIdConfigured: true } }
    ]);
    const result = spawnSync(process.execPath, ['--import', mockPath, setupCli, 'discord'], {
      cwd: repoRoot,
      input: '\n\n',
      env: {
        ...process.env,
        MURPH_APP_DIR: appDir,
        MURPH_CONFIG_PATH: path.join(appDir, 'config.yaml'),
        MURPH_CREDENTIALS_PATH: path.join(appDir, '.credentials'),
        MURPH_URL: 'http://murph.test',
        MURPH_DISCORD_API_BASE: 'http://discord.test/api/v10',
        MURPH_DISCORD_SKIP_INSTALL_CONFIRM: '1',
        MOCK_DISCORD_GUILDS: '[{"id":"guild-rest","name":"REST Guild"}]',
        MOCK_DISCORD_GUILD_SAVE_NOT_FOUND: 'always',
        DISCORD_BOT_TOKEN: 'discord-bot-token',
        DISCORD_CLIENT_SECRET: 'discord-client-secret',
        MOCK_FETCH_CALLS: callsPath,
        MOCK_SETUP_STATUSES: setupStatusesPath,
        PATH: '/usr/bin:/bin'
      },
      encoding: 'utf8'
    });

    expect(result.status).toBe(1);
    expect(result.stderr + result.stdout).toContain('local server is running an older build');
    expect(readFileSync(murphCallsPath, 'utf8')).toContain('restart');
  });

  it('validates a manual guild ID with Discord before saving it locally', () => {
    const appDir = createAppDir();
    const { callsPath, mockPath, setupStatusesPath } = createFetchMock(appDir, [
      { ok: true, discord: { installed: false, botTokenConfigured: true, clientIdConfigured: true } }
    ]);
    const result = spawnSync(process.execPath, ['--import', mockPath, setupCli, 'discord'], {
      cwd: repoRoot,
      input: '\n\n',
      env: {
        ...process.env,
        MURPH_APP_DIR: appDir,
        MURPH_CONFIG_PATH: path.join(appDir, 'config.yaml'),
        MURPH_CREDENTIALS_PATH: path.join(appDir, '.credentials'),
        MURPH_URL: 'http://murph.test',
        MURPH_DISCORD_API_BASE: 'http://discord.test/api/v10',
        MURPH_DISCORD_SKIP_INSTALL_CONFIRM: '1',
        MURPH_DISCORD_GUILD_ID: 'guild-manual',
        MOCK_DISCORD_GUILDS: '[]',
        MOCK_DISCORD_GUILD_FETCH_FAIL: '1',
        DISCORD_BOT_TOKEN: 'discord-bot-token',
        DISCORD_CLIENT_SECRET: 'discord-client-secret',
        MOCK_FETCH_CALLS: callsPath,
        MOCK_SETUP_STATUSES: setupStatusesPath,
        PATH: '/usr/bin:/bin'
      },
      encoding: 'utf8'
    });

    expect(result.status).toBe(1);
    expect(result.stderr + result.stdout).toContain('Unknown Guild');

    const calls = readCalls(callsPath);
    expect(calls.some((call) => call.url.includes('/guilds/guild-manual'))).toBe(true);
    expect(calls.some((call) => call.url.includes('/api/discord/guild'))).toBe(false);
  });

  it('does not allow manual Discord owner selection when identity is missing', () => {
    const appDir = createAppDir();
    writeFileSync(path.join(appDir, 'config.yaml'), [
      'setup:',
      '  channelProvider: discord',
      '  workspaceId: ws-discord',
      ''
    ].join('\n'));
    const { callsPath, mockPath, setupStatusesPath } = createFetchMock(appDir);
    const result = spawnSync(process.execPath, ['--import', mockPath, setupCli, 'identity'], {
      cwd: repoRoot,
      input: '',
      env: {
        ...process.env,
        MURPH_APP_DIR: appDir,
        MURPH_CONFIG_PATH: path.join(appDir, 'config.yaml'),
        MURPH_CREDENTIALS_PATH: path.join(appDir, '.credentials'),
        MURPH_URL: 'http://murph.test',
        MOCK_SETUP_MEMBERS_FAIL: '1',
        MOCK_FETCH_CALLS: callsPath,
        MOCK_SETUP_STATUSES: setupStatusesPath,
        PATH: '/usr/bin:/bin'
      },
      encoding: 'utf8'
    });

    expect(result.status, result.stderr + result.stdout).not.toBe(0);
    expect(result.stderr + result.stdout).toContain('Missing owner identity');

    const calls = readCalls(callsPath);
    expect(calls.some((call) => call.url.includes('/api/setup/members'))).toBe(false);
    expect(calls.some((call) => call.url.includes('/api/setup/member'))).toBe(false);
    expect(calls.some((call) => call.url.includes('/api/setup/defaults') && call.method === 'PUT')).toBe(false);
  });

  it('falls back to validated Discord channel IDs when channel listing is unavailable', () => {
    const appDir = createAppDir();
    writeFileSync(path.join(appDir, 'config.yaml'), [
      'channels:',
      '  discord:',
      '    clientId: app-123',
      'setup:',
      '  channelProvider: discord',
      '  workspaceId: ws-discord',
      ''
    ].join('\n'));
    const { callsPath, mockPath, setupStatusesPath } = createFetchMock(appDir);
    const result = spawnSync(process.execPath, ['--import', mockPath, setupCli, 'channels'], {
      cwd: repoRoot,
      input: 'channel-1, channel-2\n',
      env: {
        ...process.env,
        MURPH_APP_DIR: appDir,
        MURPH_CONFIG_PATH: path.join(appDir, 'config.yaml'),
        MURPH_CREDENTIALS_PATH: path.join(appDir, '.credentials'),
        MURPH_URL: 'http://murph.test',
        MOCK_SETUP_CHANNELS_FAIL: '1',
        MOCK_FETCH_CALLS: callsPath,
        MOCK_SETUP_STATUSES: setupStatusesPath,
        PATH: '/usr/bin:/bin'
      },
      encoding: 'utf8'
    });

    expect(result.status, result.stderr + result.stdout).toBe(0);
    expect(result.stdout).toContain('Failed to fetch Discord channels: Missing Access');
    expect(result.stdout).toContain('approve the requested permissions');
    expect(result.stdout).toContain('Saved 2 selected Discord channel(s).');

    const calls = readCalls(callsPath);
    expect(calls.some((call) => call.url.includes('/api/setup/channels'))).toBe(true);
    expect(calls.some((call) => call.url.includes('/api/setup/channel') && call.url.includes('channel-1'))).toBe(true);
    expect(calls.some((call) => call.url.includes('/api/setup/channel') && call.url.includes('channel-2'))).toBe(true);
    const saveCall = calls.find((call) => call.url.includes('/api/setup/defaults') && call.method === 'PUT');
    expect(saveCall?.body).toEqual(expect.objectContaining({
      channelScopeMode: 'selected',
      selectedChannels: [
        { id: 'channel-1', displayName: '#general' },
        { id: 'channel-2', displayName: '#launch' }
      ]
    }));
  });

  it('fails clearly when manual Discord channel validation fails', () => {
    const appDir = createAppDir();
    writeFileSync(path.join(appDir, 'config.yaml'), [
      'channels:',
      '  discord:',
      '    clientId: app-123',
      'setup:',
      '  channelProvider: discord',
      '  workspaceId: ws-discord',
      ''
    ].join('\n'));
    const { callsPath, mockPath, setupStatusesPath } = createFetchMock(appDir);
    const result = spawnSync(process.execPath, ['--import', mockPath, setupCli, 'channels'], {
      cwd: repoRoot,
      input: 'bad-channel\n',
      env: {
        ...process.env,
        MURPH_APP_DIR: appDir,
        MURPH_CONFIG_PATH: path.join(appDir, 'config.yaml'),
        MURPH_CREDENTIALS_PATH: path.join(appDir, '.credentials'),
        MURPH_URL: 'http://murph.test',
        MOCK_SETUP_CHANNELS_FAIL: '1',
        MOCK_SETUP_CHANNEL_INVALID: 'bad-channel',
        MOCK_FETCH_CALLS: callsPath,
        MOCK_SETUP_STATUSES: setupStatusesPath,
        PATH: '/usr/bin:/bin'
      },
      encoding: 'utf8'
    });

    expect(result.status).toBe(1);
    expect(result.stderr + result.stdout).toContain('Could not validate Discord channel bad-channel');

    const calls = readCalls(callsPath);
    expect(calls.some((call) => call.url.includes('/api/setup/defaults') && call.method === 'PUT')).toBe(false);
  });
});
