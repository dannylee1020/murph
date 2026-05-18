import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const originalCwd = process.cwd();
const envKeys = [
  'MURPH_APP_DIR',
  'MURPH_CREDENTIALS_PATH',
  'MURPH_APP_URL',
  'MURPH_SQLITE_PATH',
  'MURPH_DEFAULT_PROVIDER',
  'MURPH_DEFAULT_MODEL',
  'MURPH_AGENT_PROVIDER',
  'MURPH_AGENT_MODEL',
  'OPENAI_API_KEY',
  'ANTHROPIC_API_KEY',
  'SLACK_EVENTS_MODE',
  'SLACK_APP_TOKEN',
  'SLACK_CLIENT_ID',
  'SLACK_CLIENT_SECRET'
] as const;
const originalEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));

describe('setup env file writer', () => {
  let workspace: string;

  beforeEach(() => {
    vi.resetModules();
    workspace = mkdtempSync(path.join(tmpdir(), 'murph-setup-env-'));
    process.chdir(workspace);
    for (const key of envKeys) {
      delete process.env[key];
    }
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

  it('updates known setup keys without dropping unrelated lines', async () => {
    writeFileSync('.env', 'MURPH_APP_URL=http://localhost:5173\n\n# User setting\nCUSTOM_VALUE=keep\nOPENAI_API_KEY=old\n');
    const { updateSetupEnv } = await import('../src/lib/server/setup/env-file');

    const result = updateSetupEnv({
      MURPH_DEFAULT_PROVIDER: 'openai',
      MURPH_DEFAULT_MODEL: 'gpt-5.5',
      MURPH_AGENT_PROVIDER: 'anthropic',
      MURPH_AGENT_MODEL: 'claude-opus-4-7',
      OPENAI_API_KEY: 'sk-new',
      SLACK_EVENTS_MODE: 'socket',
      SLACK_APP_TOKEN: 'xapp-test'
    });

    expect(result.updated).toEqual([
      'OPENAI_API_KEY',
      'SLACK_APP_TOKEN',
      'MURPH_DEFAULT_PROVIDER',
      'MURPH_DEFAULT_MODEL',
      'MURPH_AGENT_PROVIDER',
      'MURPH_AGENT_MODEL',
      'SLACK_EVENTS_MODE'
    ]);
    expect(readFileSync('.env', 'utf8')).toContain('CUSTOM_VALUE=keep');
    expect(readFileSync('.env', 'utf8')).not.toContain('OPENAI_API_KEY=sk-new');
    expect(readFileSync('.env', 'utf8')).not.toContain('SLACK_APP_TOKEN=xapp-test');
    const credentials = JSON.parse(readFileSync(path.join(workspace, '.credentials'), 'utf8'));
    expect(credentials.credentials).toEqual(expect.arrayContaining([
      expect.objectContaining({ provider: 'openai', key: 'api_key', value: 'sk-new' }),
      expect.objectContaining({ provider: 'slack', key: 'app_token', value: 'xapp-test' })
    ]));
    expect(readFileSync('murph.config.yaml', 'utf8')).toContain('defaultProvider: openai');
    expect(readFileSync('murph.config.yaml', 'utf8')).toContain('defaultModel: gpt-5.5');
    expect(readFileSync('murph.config.yaml', 'utf8')).toContain('provider: anthropic');
    expect(readFileSync('murph.config.yaml', 'utf8')).toContain('model: claude-opus-4-7');
    expect(readFileSync('murph.config.yaml', 'utf8')).toContain('eventsMode: socket');
    expect(process.env.OPENAI_API_KEY).toBe('sk-new');
  });

  it('clears agent overrides through setup env updates', async () => {
    writeFileSync('murph.config.yaml', [
      'ai:',
      '  defaultProvider: openai',
      '  defaultModel: gpt-5.5',
      '  agent:',
      '    provider: anthropic',
      '    model: claude-opus-4-7',
      ''
    ].join('\n'));
    const { updateSetupEnv } = await import('../src/lib/server/setup/env-file');

    const result = updateSetupEnv({
      MURPH_AGENT_PROVIDER: '',
      MURPH_AGENT_MODEL: ''
    });

    const raw = readFileSync('murph.config.yaml', 'utf8');
    expect(result.updated).toEqual(['MURPH_AGENT_PROVIDER', 'MURPH_AGENT_MODEL']);
    expect(raw).not.toContain('provider: anthropic');
    expect(raw).not.toContain('model: claude-opus-4-7');
  });

  it('rejects unsupported keys', async () => {
    const { updateSetupEnv } = await import('../src/lib/server/setup/env-file');

    expect(() => updateSetupEnv({ NOT_A_SETUP_KEY: 'nope' })).toThrow('Unsupported setup key');
  });
});
