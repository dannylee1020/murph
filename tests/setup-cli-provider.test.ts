import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

const repoRoot = process.cwd();
const setupCli = path.join(repoRoot, 'bin/setup-cli.mjs');

function createAppDir(): string {
  const appDir = path.join(tmpdir(), `murph-setup-cli-provider-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  mkdirSync(appDir, { recursive: true });
  return appDir;
}

function createFetchMock(appDir: string): string {
  const mockPath = path.join(appDir, 'mock-fetch.mjs');
  writeFileSync(mockPath, `
globalThis.fetch = async () => Response.json({ ok: false }, { status: 404 });
`);
  return mockPath;
}

describe('setup CLI provider setup', () => {
  it('runs the provider command through the AI provider and Murph Agent setup path', () => {
    const appDir = createAppDir();
    const mockPath = createFetchMock(appDir);
    const result = spawnSync(process.execPath, ['--import', mockPath, setupCli, 'provider', '--quick'], {
      cwd: repoRoot,
      input: '',
      env: {
        ...process.env,
        MURPH_APP_DIR: appDir,
        MURPH_CONFIG_PATH: path.join(appDir, 'config.yaml'),
        MURPH_CREDENTIALS_PATH: path.join(appDir, '.credentials'),
        MURPH_URL: 'http://murph.test',
        OPENAI_API_KEY: '',
        ANTHROPIC_API_KEY: 'sk-ant-test',
        MURPH_DEFAULT_PROVIDER: 'anthropic',
        MURPH_DEFAULT_MODEL: '',
        MURPH_AGENT_PROVIDER: '',
        MURPH_AGENT_MODEL: '',
        PATH: '/usr/bin:/bin'
      },
      encoding: 'utf8'
    });

    expect(result.status, result.stderr + result.stdout).toBe(0);
    expect(result.stdout.indexOf('AI provider')).toBeGreaterThanOrEqual(0);
    expect(result.stdout).toContain('AI provider is configured (anthropic).');
    expect(result.stdout).toContain('Murph Agent inherits runtime model (anthropic/claude-opus-4-7).');
  });
});
