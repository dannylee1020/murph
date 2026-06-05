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
  'MURPH_PRODUCT_MODE',
  'MURPH_DEFAULT_PROVIDER',
  'MURPH_DEFAULT_MODEL',
  'MURPH_AGENT_PROVIDER',
  'MURPH_AGENT_MODEL',
  'OBSIDIAN_VAULT_PATH',
  'SLACK_EVENTS_MODE',
  'MURPH_WEB_SEARCH_BACKEND',
  'OPENAI_API_KEY',
  'ANTHROPIC_API_KEY'
] as const;
const originalEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));

describe('murph config file', () => {
  let workspace: string;

  beforeEach(() => {
    vi.resetModules();
    workspace = mkdtempSync(path.join(tmpdir(), 'murph-config-file-'));
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

  it('loads typed YAML values into runtime env', async () => {
    writeFileSync('config.yaml', [
      'app:',
      '  url: https://murph.example',
      '  distribution: team',
      '  timezone: Asia/Seoul',
      '  workdayStartHour: 10',
      '  workdayEndHour: 18',
      'ai:',
      '  defaultProvider: anthropic',
      '  defaultModel: claude-opus-4-7',
      '  agent:',
      '    provider: anthropic',
      '    model: claude-opus-4-7',
      'integrations:',
      '  github:',
      '    repositories:',
      '      - acme/app',
      '      - acme/api',
      ''
    ].join('\n'));

    const { getRuntimeEnv } = await import('../app/server/util/env');
    const env = getRuntimeEnv();

    expect(env.appUrl).toBe('https://murph.example');
    expect(env.distribution).toBe('team');
    expect(env.productMode).toBe('channel');
    expect(env.timezone).toBe('Asia/Seoul');
    expect(env.workdayStartHour).toBe(10);
    expect(env.workdayEndHour).toBe(18);
    expect(env.defaultProvider).toBe('anthropic');
    expect(env.defaultModel).toBe('claude-opus-4-7');
    expect(env.agentProvider).toBe('anthropic');
    expect(env.agentModel).toBe('claude-opus-4-7');
    expect(env.githubRepositories).toEqual(['acme/app', 'acme/api']);
  });

  it('does not let a blank Obsidian env override hide the configured vault path', async () => {
    writeFileSync('config.yaml', [
      'integrations:',
      '  obsidian:',
      '    vaultPath: /Users/test/Vault',
      ''
    ].join('\n'));
    process.env.OBSIDIAN_VAULT_PATH = '';

    const { getRuntimeEnv } = await import('../app/server/util/env');
    const env = getRuntimeEnv();

    expect(env.obsidianVaultPath).toBe('/Users/test/Vault');
  });

  it('uses config-backed runtime provider defaults for the model provider', async () => {
    writeFileSync('config.yaml', [
      'ai:',
      '  defaultProvider: anthropic',
      '  defaultModel: claude-opus-4-7',
      ''
    ].join('\n'));
    const { writeSecret } = await import('../app/server/credentials/local-store');
    writeSecret('anthropic', 'api_key', 'sk-ant-test');

    const { getModelProvider } = await import('../app/server/providers/index');
    const provider = getModelProvider();

    expect(provider.name).toBe('anthropic');
    expect((provider as any).model).toBe('claude-opus-4-7');
  });

  it('lets environment values override YAML', async () => {
    writeFileSync('config.yaml', [
      'app:',
      '  url: https://murph.example',
      'ai:',
      '  defaultProvider: anthropic',
      '  defaultModel: claude-opus-4-7',
      '  agent:',
      '    provider: anthropic',
      '    model: claude-opus-4-7',
      ''
    ].join('\n'));
    process.env.MURPH_APP_URL = 'https://override.example';
    process.env.MURPH_DISTRIBUTION = 'team';
    process.env.MURPH_AGENT_PROVIDER = 'openai';
    process.env.MURPH_AGENT_MODEL = 'gpt-5.5';

    const { getRuntimeEnv } = await import('../app/server/util/env');
    const env = getRuntimeEnv();

    expect(env.appUrl).toBe('https://override.example');
    expect(env.distribution).toBe('team');
    expect(env.productMode).toBe('channel');
    expect(env.agentProvider).toBe('openai');
    expect(env.agentModel).toBe('gpt-5.5');
  });

  it('prefers local credentials over environment secrets', async () => {
    process.env.OPENAI_API_KEY = 'env-key';
    const { writeSecret } = await import('../app/server/credentials/local-store');
    writeSecret('openai', 'api_key', 'stored-key');

    const { getRuntimeEnv } = await import('../app/server/util/env');
    const env = getRuntimeEnv();

    expect(env.openaiApiKey).toBe('stored-key');
  });

  it('updates non-secret setup keys without dropping unrelated YAML', async () => {
    writeFileSync('config.yaml', 'custom:\n  keep: true\n');
    const { updateMurphConfigValues } = await import('../app/server/setup/config-file');

    const result = updateMurphConfigValues({
      MURPH_APP_URL: 'https://murph.example',
      MURPH_DISTRIBUTION: 'team',
      MURPH_PRODUCT_MODE: 'channel',
      MURPH_DEFAULT_MODEL: 'gpt-5.5',
      MURPH_AGENT_MODEL: 'claude-opus-4-7',
      GITHUB_REPOSITORIES: 'acme/app,acme/api',
      OBSIDIAN_VAULT_PATH: '/Users/test/Vault'
    });

    const raw = readFileSync('config.yaml', 'utf8');
    expect(result.updated).toEqual(['MURPH_APP_URL', 'MURPH_DISTRIBUTION', 'MURPH_PRODUCT_MODE', 'MURPH_DEFAULT_MODEL', 'MURPH_AGENT_MODEL', 'GITHUB_REPOSITORIES', 'OBSIDIAN_VAULT_PATH']);
    expect(raw).toContain('keep: true');
    expect(raw).toContain('url: https://murph.example');
    expect(raw).toContain('distribution: team');
    expect(raw).toContain('productMode: channel');
    expect(raw).toContain('defaultModel: gpt-5.5');
    expect(raw).toContain('model: claude-opus-4-7');
    expect(raw).toContain('- acme/app');
    expect(raw).toContain('- acme/api');
    expect(raw).toContain('vaultPath: /Users/test/Vault');
  });

  it('defaults to the team distribution and maps legacy channel mode to team', async () => {
    const { getRuntimeEnv } = await import('../app/server/util/env');
    expect(getRuntimeEnv().distribution).toBe('team');
    expect(getRuntimeEnv().productMode).toBe('channel');

    vi.resetModules();
    process.env.MURPH_PRODUCT_MODE = 'channel';
    const { getRuntimeEnv: getEnvWithLegacyMode } = await import('../app/server/util/env');
    expect(getEnvWithLegacyMode().distribution).toBe('team');
    expect(getEnvWithLegacyMode().productMode).toBe('channel');
  });

  it('ignores legacy personal product mode when the runtime distribution is team', async () => {
    process.env.MURPH_DISTRIBUTION = 'team';
    process.env.MURPH_PRODUCT_MODE = 'personal';

    const { getRuntimeEnv } = await import('../app/server/util/env');
    const env = getRuntimeEnv();

    expect(env.distribution).toBe('team');
    expect(env.productMode).toBe('channel');
  });

  it('rejects explicit personal runtime config updates', async () => {
    const { updateMurphConfigValues } = await import('../app/server/setup/config-file');

    expect(() => updateMurphConfigValues({
      MURPH_DISTRIBUTION: 'personal'
    })).toThrow(/Murph Personal is no longer a supported runtime/);
  });

  it('clears explicit Murph Agent overrides so the agent can inherit runtime', async () => {
    writeFileSync('config.yaml', [
      'ai:',
      '  defaultProvider: openai',
      '  defaultModel: gpt-5.5',
      '  agent:',
      '    provider: anthropic',
      '    model: claude-opus-4-7',
      ''
    ].join('\n'));
    const { updateMurphConfigValues } = await import('../app/server/setup/config-file');

    const result = updateMurphConfigValues({
      MURPH_AGENT_PROVIDER: '',
      MURPH_AGENT_MODEL: ''
    });

    const raw = readFileSync('config.yaml', 'utf8');
    expect(result.updated).toEqual(['MURPH_AGENT_PROVIDER', 'MURPH_AGENT_MODEL']);
    expect(raw).toContain('defaultProvider: openai');
    expect(raw).toContain('defaultModel: gpt-5.5');
    expect(raw).not.toContain('provider: anthropic');
    expect(raw).not.toContain('model: claude-opus-4-7');
  });

  it('clears Obsidian vault path config because it is non-secret local setup state', async () => {
    writeFileSync('config.yaml', [
      'integrations:',
      '  obsidian:',
      '    vaultPath: /Users/test/Vault',
      ''
    ].join('\n'));
    const { updateMurphConfigValues } = await import('../app/server/setup/config-file');

    const result = updateMurphConfigValues({
      OBSIDIAN_VAULT_PATH: ''
    });

    const raw = readFileSync('config.yaml', 'utf8');
    expect(result.updated).toEqual(['OBSIDIAN_VAULT_PATH']);
    expect(raw).not.toContain('vaultPath');
  });
});
