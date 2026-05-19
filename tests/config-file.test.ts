import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const originalCwd = process.cwd();
const envKeys = [
  'MURPH_APP_DIR',
  'MURPH_CONFIG_PATH',
  'MURPH_APP_URL',
  'MURPH_DEFAULT_PROVIDER',
  'MURPH_DEFAULT_MODEL',
  'MURPH_AGENT_PROVIDER',
  'MURPH_AGENT_MODEL',
  'SLACK_EVENTS_MODE',
  'MURPH_WEB_SEARCH_BACKEND',
  'OPENAI_API_KEY'
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
      'ai:',
      '  defaultProvider: anthropic',
      '  defaultModel: claude-opus-4-7',
      '  agent:',
      '    provider: anthropic',
      '    model: claude-opus-4-7',
      'channels:',
      '  slack:',
      '    eventsMode: http',
      'integrations:',
      '  github:',
      '    repositories:',
      '      - acme/app',
      '      - acme/api',
      ''
    ].join('\n'));

    const { getRuntimeEnv } = await import('../src/lib/server/util/env');
    const env = getRuntimeEnv();

    expect(env.appUrl).toBe('https://murph.example');
    expect(env.defaultProvider).toBe('anthropic');
    expect(env.defaultModel).toBe('claude-opus-4-7');
    expect(env.agentProvider).toBe('anthropic');
    expect(env.agentModel).toBe('claude-opus-4-7');
    expect(env.slackEventsMode).toBe('http');
    expect(env.githubRepositories).toEqual(['acme/app', 'acme/api']);
  });

  it('lets Murph Agent inherit runtime provider and model by default', async () => {
    writeFileSync('config.yaml', [
      'ai:',
      '  defaultProvider: anthropic',
      '  defaultModel: claude-opus-4-7',
      ''
    ].join('\n'));

    const { getRuntimeEnv } = await import('../src/lib/server/util/env');
    const env = getRuntimeEnv();

    expect(env.defaultProvider).toBe('anthropic');
    expect(env.defaultModel).toBe('claude-opus-4-7');
    expect(env.agentProvider).toBe('anthropic');
    expect(env.agentModel).toBe('claude-opus-4-7');
  });

  it('defaults web search to Brave', async () => {
    const { getRuntimeEnv } = await import('../src/lib/server/util/env');

    expect(getRuntimeEnv().webSearchBackend).toBe('brave');
  });

  it('lets YAML select Tavily web search', async () => {
    writeFileSync('config.yaml', [
      'integrations:',
      '  webSearch:',
      '    backend: tavily',
      ''
    ].join('\n'));

    const { getRuntimeEnv } = await import('../src/lib/server/util/env');

    expect(getRuntimeEnv().webSearchBackend).toBe('tavily');
  });

  it('lets env select Tavily web search', async () => {
    process.env.MURPH_WEB_SEARCH_BACKEND = 'tavily';
    const { getRuntimeEnv } = await import('../src/lib/server/util/env');

    expect(getRuntimeEnv().webSearchBackend).toBe('tavily');
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
    process.env.MURPH_AGENT_PROVIDER = 'openai';
    process.env.MURPH_AGENT_MODEL = 'gpt-5.5';

    const { getRuntimeEnv } = await import('../src/lib/server/util/env');
    const env = getRuntimeEnv();

    expect(env.appUrl).toBe('https://override.example');
    expect(env.agentProvider).toBe('openai');
    expect(env.agentModel).toBe('gpt-5.5');
  });

  it('updates non-secret setup keys without dropping unrelated YAML', async () => {
    writeFileSync('config.yaml', 'custom:\n  keep: true\n');
    const { updateMurphConfigValues } = await import('../src/lib/server/setup/config-file');

    const result = updateMurphConfigValues({
      MURPH_APP_URL: 'https://murph.example',
      MURPH_DEFAULT_MODEL: 'gpt-5.5',
      MURPH_AGENT_MODEL: 'claude-opus-4-7',
      GITHUB_REPOSITORIES: 'acme/app,acme/api'
    });

    const raw = readFileSync('config.yaml', 'utf8');
    expect(result.updated).toEqual(['MURPH_APP_URL', 'MURPH_DEFAULT_MODEL', 'MURPH_AGENT_MODEL', 'GITHUB_REPOSITORIES']);
    expect(raw).toContain('keep: true');
    expect(raw).toContain('url: https://murph.example');
    expect(raw).toContain('defaultModel: gpt-5.5');
    expect(raw).toContain('model: claude-opus-4-7');
    expect(raw).toContain('- acme/app');
    expect(raw).toContain('- acme/api');
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
    const { updateMurphConfigValues } = await import('../src/lib/server/setup/config-file');

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
});
