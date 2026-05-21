import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const envKeys = ['MURPH_CONFIG_PATH', 'MURPH_CREDENTIALS_PATH', 'DISCORD_CLIENT_ID', 'DISCORD_CLIENT_SECRET', 'DISCORD_BOT_TOKEN'] as const;
const originalEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));

describe('Discord install URL', () => {
  beforeEach(() => {
    vi.resetModules();
    const workspace = mkdtempSync(path.join(tmpdir(), 'murph-discord-install-url-'));
    process.env.MURPH_CONFIG_PATH = path.join(workspace, 'config.yaml');
    process.env.MURPH_CREDENTIALS_PATH = path.join(workspace, '.credentials');
    process.env.DISCORD_CLIENT_ID = '1234567890';
    process.env.DISCORD_CLIENT_SECRET = 'client-secret';
    process.env.DISCORD_BOT_TOKEN = 'bot-token';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    for (const key of envKeys) {
      if (originalEnv[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = originalEnv[key];
      }
    }
  });

  it('uses bot install authorization and identify for browser OAuth', async () => {
    const { DiscordService, DISCORD_BOT_PERMISSIONS } = await import('../src/lib/server/channels/discord/service');

    const url = new DiscordService().buildInstallUrl({ appUrl: 'http://murph.test' });

    expect(url).toBeTruthy();
    const params = new URL(url!).searchParams;
    expect(params.get('client_id')).toBe('1234567890');
    expect(params.get('scope')).toBe('bot identify');
    expect(params.get('permissions')).toBe(DISCORD_BOT_PERMISSIONS);
    expect(params.get('redirect_uri')).toBe('http://murph.test/api/discord/oauth/callback');
    expect(params.get('response_type')).toBe('code');
  });

  it('configures install permissions and limited privileged intent flags', async () => {
    const calls: Array<{ url: string; method: string; body?: Record<string, unknown> }> = [];
    vi.stubGlobal('fetch', async (url: string, options: RequestInit = {}) => {
      const body = options.body ? JSON.parse(String(options.body)) : undefined;
      calls.push({ url: String(url), method: options.method ?? 'GET', body });
      if (String(url).includes('/oauth2/applications/@me')) {
        return Response.json({ id: 'app-123', flags: 4 });
      }
      return Response.json({ id: 'app-123' });
    });
    const { DiscordService, DISCORD_BOT_PERMISSIONS } = await import('../src/lib/server/channels/discord/service');

    const result = await new DiscordService().configureApplication();

    expect(result).toEqual({ permissionsConfigured: true, intentsConfigured: true });
    const patch = calls.find((call) => call.url.includes('/applications/@me') && call.method === 'PATCH');
    expect(patch?.body).toEqual(expect.objectContaining({
      install_params: {
        scopes: ['bot'],
        permissions: DISCORD_BOT_PERMISSIONS
      },
      integration_types_config: {
        0: {
          oauth2_install_params: {
            scopes: ['bot'],
            permissions: DISCORD_BOT_PERMISSIONS
          }
        }
      },
      flags: 557060
    }));
  });

  it('fetches a single Discord member display name', async () => {
    vi.stubGlobal('fetch', async (url: string) => {
      expect(String(url)).toContain('/guilds/guild-1/members/user-1');
      return Response.json({
        user: { id: 'user-1', username: 'daniel', global_name: 'Daniel Lee' },
        nick: 'Danny'
      });
    });
    const { DiscordService } = await import('../src/lib/server/channels/discord/service');

    const member = await new DiscordService().getMember({
      id: 'ws-discord',
      provider: 'discord',
      externalWorkspaceId: 'guild-1',
      name: 'Guild'
    }, 'user-1');

    expect(member).toEqual({ id: 'user-1', displayName: 'Danny' });
  });

  it('preserves Discord channel list error details', async () => {
    vi.stubGlobal('fetch', async () => Response.json({ message: 'Missing Access' }, { status: 403 }));
    const { DiscordService } = await import('../src/lib/server/channels/discord/service');

    await expect(new DiscordService().listChannels({
      id: 'ws-discord',
      provider: 'discord',
      externalWorkspaceId: 'guild-1',
      name: 'Guild'
    })).rejects.toThrow('Failed to fetch Discord channels: Missing Access');
  });

  it('fetches a single Discord text channel', async () => {
    vi.stubGlobal('fetch', async (url: string) => {
      expect(String(url)).toContain('/channels/channel-1');
      return Response.json({ id: 'channel-1', name: 'general', type: 0, guild_id: 'guild-1' });
    });
    const { DiscordService } = await import('../src/lib/server/channels/discord/service');

    const channel = await new DiscordService().getChannel({
      id: 'ws-discord',
      provider: 'discord',
      externalWorkspaceId: 'guild-1',
      name: 'Guild'
    }, 'channel-1');

    expect(channel).toEqual({ id: 'channel-1', displayName: '#general', isPrivate: false, isMember: true });
  });

  it('rejects unsupported Discord channel types', async () => {
    vi.stubGlobal('fetch', async () => Response.json({ id: 'channel-1', name: 'voice', type: 2, guild_id: 'guild-1' }));
    const { DiscordService } = await import('../src/lib/server/channels/discord/service');

    await expect(new DiscordService().getChannel({
      id: 'ws-discord',
      provider: 'discord',
      externalWorkspaceId: 'guild-1',
      name: 'Guild'
    }, 'channel-1')).rejects.toThrow('Discord channel is not a supported text channel');
  });
});
