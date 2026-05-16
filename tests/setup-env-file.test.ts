import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const originalCwd = process.cwd();
const envKeys = [
  'MURPH_APP_DIR',
  'MURPH_APP_URL',
  'MURPH_SQLITE_PATH',
  'MURPH_ENCRYPTION_KEY',
  'MURPH_DEFAULT_PROVIDER',
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
      MURPH_ENCRYPTION_KEY: 'secret',
      OPENAI_API_KEY: 'sk-new',
      SLACK_EVENTS_MODE: 'socket',
      SLACK_APP_TOKEN: 'xapp-test'
    });

    expect(result.updated).toEqual(['MURPH_ENCRYPTION_KEY', 'OPENAI_API_KEY', 'SLACK_APP_TOKEN', 'MURPH_DEFAULT_PROVIDER', 'SLACK_EVENTS_MODE']);
    expect(readFileSync('.env', 'utf8')).toContain('CUSTOM_VALUE=keep');
    expect(readFileSync('.env', 'utf8')).toContain('MURPH_ENCRYPTION_KEY=secret');
    expect(readFileSync('.env', 'utf8')).toContain('OPENAI_API_KEY=sk-new');
    expect(readFileSync('.env', 'utf8')).toContain('SLACK_APP_TOKEN=xapp-test');
    expect(readFileSync('murph.config.yaml', 'utf8')).toContain('defaultProvider: openai');
    expect(readFileSync('murph.config.yaml', 'utf8')).toContain('eventsMode: socket');
    expect(process.env.OPENAI_API_KEY).toBe('sk-new');
  });

  it('rejects unsupported keys', async () => {
    const { updateSetupEnv } = await import('../src/lib/server/setup/env-file');

    expect(() => updateSetupEnv({ NOT_A_SETUP_KEY: 'nope' })).toThrow('Unsupported setup key');
  });
});
