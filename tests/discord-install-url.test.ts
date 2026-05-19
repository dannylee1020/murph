import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const envKeys = ['MURPH_CONFIG_PATH', 'MURPH_CREDENTIALS_PATH', 'DISCORD_CLIENT_ID', 'DISCORD_BOT_TOKEN'] as const;
const originalEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));

describe('Discord install URL', () => {
  beforeEach(() => {
    vi.resetModules();
    const workspace = mkdtempSync(path.join(tmpdir(), 'murph-discord-install-url-'));
    process.env.MURPH_CONFIG_PATH = path.join(workspace, 'config.yaml');
    process.env.MURPH_CREDENTIALS_PATH = path.join(workspace, '.credentials');
    process.env.DISCORD_CLIENT_ID = '1234567890';
    process.env.DISCORD_BOT_TOKEN = 'bot-token';
  });

  afterEach(() => {
    for (const key of envKeys) {
      if (originalEnv[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = originalEnv[key];
      }
    }
  });

  it('uses bot authorization without OAuth callback credentials', async () => {
    const { DiscordService, DISCORD_BOT_PERMISSIONS } = await import('../src/lib/server/channels/discord/service');

    const url = new DiscordService().buildInstallUrl();

    expect(url).toBeTruthy();
    const params = new URL(url!).searchParams;
    expect(params.get('client_id')).toBe('1234567890');
    expect(params.get('scope')).toBe('bot');
    expect(params.get('permissions')).toBe(DISCORD_BOT_PERMISSIONS);
    expect(params.get('redirect_uri')).toBeNull();
    expect(params.get('response_type')).toBeNull();
  });
});
