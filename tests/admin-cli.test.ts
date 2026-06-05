import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

const repoRoot = process.cwd();
const adminCli = join(repoRoot, 'app/cli/admin-cli.mjs');

type FetchCall = {
  url: string;
  method: string;
};

function createFixture() {
  const root = mkdtempSync(join(tmpdir(), 'murph-admin-cli-'));
  const callsPath = join(root, 'fetch-calls.jsonl');
  const mockPath = join(root, 'mock-fetch.mjs');
  mkdirSync(root, { recursive: true });
  writeFileSync(mockPath, `
import { appendFileSync } from 'node:fs';

const callsPath = process.env.MOCK_FETCH_CALLS;

globalThis.fetch = async (url, options = {}) => {
  appendFileSync(callsPath, JSON.stringify({ url: String(url), method: options.method || 'GET' }) + '\\n');
  return Response.json({ ok: false, error: 'not_found' }, { status: 404 });
};
`);
  return { root, callsPath, mockPath };
}

function runAdmin(args: string[], fixture: ReturnType<typeof createFixture>) {
  return spawnSync(process.execPath, ['--import', fixture.mockPath, adminCli, ...args], {
    cwd: repoRoot,
    env: {
      ...process.env,
      MURPH_HOME: fixture.root,
      MURPH_URL: 'https://host.test',
      MOCK_FETCH_CALLS: fixture.callsPath
    },
    encoding: 'utf8'
  });
}

function readCalls(callsPath: string): FetchCall[] {
  if (!existsSync(callsPath)) return [];
  return readFileSync(callsPath, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as FetchCall);
}

describe('admin CLI', () => {
  it('prints the plain admin dashboard URL', () => {
    const fixture = createFixture();

    const result = runAdmin(['url'], fixture);

    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe('https://host.test/admin');
    expect(readCalls(fixture.callsPath)).toEqual([]);
  });

  it('rejects removed subscriber dashboard commands without network calls', () => {
    const fixture = createFixture();

    const result = runAdmin(['subscribers', 'link', 'U1'], fixture);

    expect(result.status).not.toBe(0);
    expect(result.stdout).toContain('Usage: murph admin <command>');
    expect(readCalls(fixture.callsPath)).toEqual([]);
  });
});
