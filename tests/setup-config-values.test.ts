import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const originalCwd = process.cwd();
const envKeys = [
  'MURPH_APP_DIR',
  'MURPH_CONFIG_PATH',
  'MURPH_CREDENTIALS_PATH',
  'MURPH_APP_URL',
  'MURPH_TIMEZONE',
  'MURPH_WORKDAY_START_HOUR',
  'MURPH_WORKDAY_END_HOUR',
  'MURPH_DISTRIBUTION',
  'MURPH_SQLITE_PATH',
  'MURPH_DEFAULT_PROVIDER',
  'MURPH_DEFAULT_MODEL',
  'MURPH_AGENT_PROVIDER',
  'MURPH_AGENT_MODEL',
  'OPENAI_API_KEY',
  'ANTHROPIC_API_KEY',
  'SLACK_EVENTS_MODE',
  'SLACK_APP_TOKEN',
  'SLACK_APP_ID',
  'SLACK_TEAM_ID',
  'SLACK_TEAM_NAME',
  'SLACK_CLIENT_ID',
  'SLACK_CLIENT_SECRET',
  'SLACK_SIGNING_SECRET'
] as const;
const originalEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));

describe('setup config value writer', () => {
  let workspace: string;

  beforeEach(() => {
    vi.resetModules();
    workspace = mkdtempSync(path.join(tmpdir(), 'murph-setup-config-'));
    process.chdir(workspace);
    for (const key of envKeys) {
      delete process.env[key];
    }
    process.env.MURPH_CONFIG_PATH = path.join(workspace, 'config.yaml');
    process.env.MURPH_CREDENTIALS_PATH = path.join(workspace, '.credentials');
  });

  afterEach(() => {
    process.chdir(originalCwd);
    for (const key of envKeys) {
      if (originalEnv[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = originalEnv[key];
      }
    }
  });

  it('writes known setup keys to config and credentials', async () => {
    writeFileSync('config.yaml', 'custom:\n  keep: true\n');
    const { updateSetupConfigValues } = await import('../shared/server/setup/config-values');

    const result = updateSetupConfigValues({
      MURPH_DEFAULT_PROVIDER: 'openai',
      MURPH_DISTRIBUTION: 'team',
      MURPH_DEFAULT_MODEL: 'gpt-5.5',
      MURPH_AGENT_PROVIDER: 'anthropic',
      MURPH_AGENT_MODEL: 'claude-opus-4-7',
      OPENAI_API_KEY: 'sk-new',
      SLACK_EVENTS_MODE: 'socket',
      SLACK_APP_TOKEN: 'xapp-test',
      SLACK_APP_ID: 'A123',
      SLACK_TEAM_ID: 'T123',
      SLACK_TEAM_NAME: 'Murph Test',
      SLACK_SIGNING_SECRET: 'signing-test'
    });

    expect(result.updated).toEqual([
      'OPENAI_API_KEY',
      'SLACK_APP_TOKEN',
      'SLACK_SIGNING_SECRET',
      'MURPH_DEFAULT_PROVIDER',
      'MURPH_DISTRIBUTION',
      'MURPH_DEFAULT_MODEL',
      'MURPH_AGENT_PROVIDER',
      'MURPH_AGENT_MODEL',
      'SLACK_EVENTS_MODE',
      'SLACK_APP_ID',
      'SLACK_TEAM_ID',
      'SLACK_TEAM_NAME'
    ]);
    const credentials = JSON.parse(readFileSync(path.join(workspace, '.credentials'), 'utf8'));
    expect(credentials.credentials).toEqual(expect.arrayContaining([
      expect.objectContaining({ provider: 'openai', key: 'api_key', value: 'sk-new' }),
      expect.objectContaining({ provider: 'slack', key: 'app_token', value: 'xapp-test' }),
      expect.objectContaining({ provider: 'slack', key: 'signing_secret', value: 'signing-test' })
    ]));
    expect(readFileSync('config.yaml', 'utf8')).toContain('keep: true');
    expect(readFileSync('config.yaml', 'utf8')).toContain('distribution: team');
    expect(readFileSync('config.yaml', 'utf8')).toContain('defaultProvider: openai');
    expect(readFileSync('config.yaml', 'utf8')).toContain('defaultModel: gpt-5.5');
    expect(readFileSync('config.yaml', 'utf8')).toContain('provider: anthropic');
    expect(readFileSync('config.yaml', 'utf8')).toContain('model: claude-opus-4-7');
    expect(readFileSync('config.yaml', 'utf8')).not.toContain('channels:');
    const { getStore } = await import('../shared/server/persistence/store');
    expect(getStore().getBotAppConfig('slack', 'channel')).toMatchObject({
      appId: 'A123',
      eventsMode: 'socket',
      metadata: {
        teamId: 'T123',
        teamName: 'Murph Test'
      }
    });
    expect(process.env.OPENAI_API_KEY).toBe('sk-new');
  });

  it('rejects unsupported keys', async () => {
    const { updateSetupConfigValues } = await import('../shared/server/setup/config-values');

    expect(() => updateSetupConfigValues({ NOT_A_SETUP_KEY: 'nope' })).toThrow('Unsupported setup key');
  });

  it('writes schedule setup keys to app config', async () => {
    writeFileSync('config.yaml', 'app:\n  url: http://localhost:5173\n');
    const { updateSetupConfigValues } = await import('../shared/server/setup/config-values');

    const result = updateSetupConfigValues({
      MURPH_TIMEZONE: 'Asia/Seoul',
      MURPH_WORKDAY_START_HOUR: '10',
      MURPH_WORKDAY_END_HOUR: '18'
    });

    const config = readFileSync('config.yaml', 'utf8');
    expect(result.updated).toEqual([
      'MURPH_TIMEZONE',
      'MURPH_WORKDAY_START_HOUR',
      'MURPH_WORKDAY_END_HOUR'
    ]);
    expect(config).toContain('timezone: Asia/Seoul');
    expect(config).toContain('workdayStartHour: 10');
    expect(config).toContain('workdayEndHour: 18');
  });
});
