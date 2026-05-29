import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

const repoRoot = process.cwd();
const adminCli = join(repoRoot, 'shared/cli/admin-cli.mjs');

type FetchCall = {
  url: string;
  method: string;
  headers: Record<string, string>;
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
  const method = options.method || 'GET';
  const headers = Object.fromEntries(new Headers(options.headers || {}).entries());
  appendFileSync(callsPath, JSON.stringify({ url: String(url), method, headers }) + '\\n');

  if (String(url).includes('/api/gateway/subscriptions/U1/dashboard-link') && method === 'POST') {
    return Response.json({
      ok: true,
      url: 'https://host.test/me?token=user-token',
      subscription: { externalUserId: 'U1', dashboardAccessEnabled: true }
    });
  }

  if (String(url).includes('/api/gateway/subscriptions/U1/dashboard-link') && method === 'DELETE') {
    return Response.json({
      ok: true,
      subscription: { externalUserId: 'U1', dashboardAccessEnabled: false }
    });
  }

  if (String(url).includes('/api/gateway/subscriptions')) {
    return Response.json({
      subscriptions: [
        {
          externalUserId: 'U1',
          displayName: 'User One',
          status: 'active',
          channelScopeMode: 'all_accessible',
          channelScope: [],
          policyProfileName: 'engineering',
          policyMode: 'manual_review',
          dashboardAccessEnabled: true
        },
        {
          externalUserId: 'U2',
          displayName: 'User Two',
          status: 'paused',
          channelScopeMode: 'selected',
          channelScope: ['C1', 'C2'],
          dashboardAccessEnabled: false
        }
      ]
    });
  }

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

describe('admin CLI subscriber dashboard links', () => {
  it('prints the plain admin dashboard URL', () => {
    const fixture = createFixture();

    const result = runAdmin(['url'], fixture);

    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe('https://host.test/admin');
    expect(readCalls(fixture.callsPath)).toEqual([]);
  });

  it('does not expose operator token rotation', () => {
    const fixture = createFixture();

    const result = runAdmin(['rotate-token'], fixture);

    expect(result.status).not.toBe(0);
    expect(result.stdout).toContain('Usage: murph admin <command>');
  });

  it('lists subscriber dashboard access without auth headers', () => {
    const fixture = createFixture();

    const result = runAdmin(['subscribers', '--workspace-id', 'W1', '--status', 'active'], fixture);
    const calls = readCalls(fixture.callsPath);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('U1');
    expect(result.stdout).toContain('dashboard enabled');
    expect(result.stdout).toContain('U2');
    expect(calls).toEqual([expect.objectContaining({
      method: 'GET',
      url: 'https://host.test/api/gateway/subscriptions?workspaceId=W1&status=active',
      headers: {}
    })]);
  });

  it('creates or regenerates a subscriber dashboard link', () => {
    const fixture = createFixture();

    const result = runAdmin(['subscribers', 'link', 'U1', '--workspace-id', 'W1'], fixture);
    const calls = readCalls(fixture.callsPath);

    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe('https://host.test/me?token=user-token');
    expect(calls).toEqual([expect.objectContaining({
      method: 'POST',
      url: 'https://host.test/api/gateway/subscriptions/U1/dashboard-link?workspaceId=W1',
      headers: {}
    })]);
  });

  it('revokes a subscriber dashboard link', () => {
    const fixture = createFixture();

    const result = runAdmin(['subscribers', 'revoke', 'U1', '--workspace-id', 'W1'], fixture);
    const calls = readCalls(fixture.callsPath);

    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe('Revoked subscriber dashboard access for U1.');
    expect(calls).toEqual([expect.objectContaining({
      method: 'DELETE',
      url: 'https://host.test/api/gateway/subscriptions/U1/dashboard-link?workspaceId=W1',
      headers: {}
    })]);
  });

  it('prints machine-readable JSON when requested', () => {
    const fixture = createFixture();

    const result = runAdmin(['subscribers', 'link', 'U1', '--workspace-id', 'W1', '--json'], fixture);
    const payload = JSON.parse(result.stdout);

    expect(result.status).toBe(0);
    expect(payload).toMatchObject({
      ok: true,
      url: 'https://host.test/me?token=user-token',
      subscription: {
        externalUserId: 'U1',
        dashboardAccessEnabled: true
      }
    });
  });
});
