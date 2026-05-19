import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const envKeys = ['MURPH_APP_DIR', 'MURPH_CONFIG_PATH', 'MURPH_CREDENTIALS_PATH', 'SLACK_CLIENT_ID'] as const;
const originalEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));

describe('Slack install URL', () => {
  beforeEach(() => {
    vi.resetModules();
    const workspace = mkdtempSync(path.join(tmpdir(), 'murph-slack-install-url-'));
    process.env.MURPH_APP_DIR = workspace;
    process.env.MURPH_CONFIG_PATH = path.join(workspace, 'config.yaml');
    process.env.MURPH_CREDENTIALS_PATH = path.join(workspace, '.credentials');
    process.env.SLACK_CLIENT_ID = 'client-id';
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

  it('passes selected Slack team into OAuth', async () => {
    const { SlackService } = await import('../src/lib/server/channels/slack/service');

    const url = new SlackService().buildInstallUrl('http://murph.test', 'T123');

    expect(url).toBeTruthy();
    const params = new URL(url!).searchParams;
    expect(params.get('client_id')).toBe('client-id');
    expect(params.get('team')).toBe('T123');
    expect(params.get('state')).toBeNull();
  });

  it('marks CLI-originated installs in OAuth state', async () => {
    const { SlackService } = await import('../src/lib/server/channels/slack/service');

    const url = new SlackService().buildInstallUrl('http://murph.test', 'T123', 'cli');

    expect(url).toBeTruthy();
    const params = new URL(url!).searchParams;
    expect(params.get('team')).toBe('T123');
    expect(params.get('state')).toBe('cli');
  });
});
