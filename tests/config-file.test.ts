import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const originalCwd = process.cwd();
const envKeys = [
  'MURPH_APP_DIR',
  'MURPH_APP_URL',
  'MURPH_DEFAULT_PROVIDER',
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
    writeFileSync('murph.config.yaml', [
      'app:',
      '  url: https://murph.example',
      'ai:',
      '  defaultProvider: anthropic',
      '  agent:',
      '    provider: anthropic',
      '    model: claude-sonnet-4-6',
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
    expect(env.agentProvider).toBe('anthropic');
    expect(env.agentModel).toBe('claude-sonnet-4-6');
    expect(env.slackEventsMode).toBe('http');
    expect(env.githubRepositories).toEqual(['acme/app', 'acme/api']);
  });

  it('defaults web search to Brave', async () => {
    const { getRuntimeEnv } = await import('../src/lib/server/util/env');

    expect(getRuntimeEnv().webSearchBackend).toBe('brave');
  });

  it('lets YAML select Tavily web search', async () => {
    writeFileSync('murph.config.yaml', [
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
    writeFileSync('murph.config.yaml', [
      'app:',
      '  url: https://murph.example',
      'ai:',
      '  defaultProvider: anthropic',
      '  agent:',
      '    provider: anthropic',
      '    model: claude-sonnet-4-6',
      ''
    ].join('\n'));
    process.env.MURPH_APP_URL = 'https://override.example';
    process.env.MURPH_AGENT_PROVIDER = 'openai';
    process.env.MURPH_AGENT_MODEL = 'gpt-5.4-mini';

    const { getRuntimeEnv } = await import('../src/lib/server/util/env');
    const env = getRuntimeEnv();

    expect(env.appUrl).toBe('https://override.example');
    expect(env.agentProvider).toBe('openai');
    expect(env.agentModel).toBe('gpt-5.4-mini');
  });

  it('updates non-secret setup keys without dropping unrelated YAML', async () => {
    writeFileSync('murph.config.yaml', 'custom:\n  keep: true\n');
    const { updateMurphConfigValues } = await import('../src/lib/server/setup/config-file');

    const result = updateMurphConfigValues({
      MURPH_APP_URL: 'https://murph.example',
      MURPH_AGENT_MODEL: 'gpt-5.4-mini',
      GITHUB_REPOSITORIES: 'acme/app,acme/api'
    });

    const raw = readFileSync('murph.config.yaml', 'utf8');
    expect(result.updated).toEqual(['MURPH_APP_URL', 'MURPH_AGENT_MODEL', 'GITHUB_REPOSITORIES']);
    expect(raw).toContain('keep: true');
    expect(raw).toContain('url: https://murph.example');
    expect(raw).toContain('model: gpt-5.4-mini');
    expect(raw).toContain('- acme/app');
    expect(raw).toContain('- acme/api');
  });
});
