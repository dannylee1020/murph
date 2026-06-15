import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = process.cwd();
const repoCli = join(repoRoot, 'app/cli/murph');

function createFixture() {
  const root = mkdtempSync(join(tmpdir(), 'murph-cli-monitor-'));
  const toolsDir = join(root, 'tools');
  const recordsPath = join(root, 'records.jsonl');
  const mockFetchPath = join(root, 'mock-fetch.mjs');
  mkdirSync(toolsDir, { recursive: true });
  writeFileSync(join(toolsDir, 'curl'), '#!/usr/bin/env bash\nprintf \'{"ok":true,"service":"murph"}\'\n');
  chmodSync(join(toolsDir, 'curl'), 0o755);
  writeFileSync(mockFetchPath, `
import { appendFileSync } from 'node:fs';

const sessions = [
  {
    id: 'session-1',
    workspaceId: 'workspace-1',
    title: 'Existing coverage',
    mode: 'manual_review',
    status: 'active',
    channelScope: ['C1'],
    startedAt: '2026-06-14T10:00:00.000Z',
    endsAt: '2026-06-14T18:00:00.000Z'
  },
  {
    id: 'session-2',
    workspaceId: 'workspace-2',
    title: 'Second coverage',
    mode: 'dry_run',
    status: 'active',
    channelScope: [],
    startedAt: '2026-06-14T10:00:00.000Z',
    endsAt: '2026-06-14T18:00:00.000Z'
  }
];

function record(method, path, body) {
  appendFileSync(process.env.MURPH_TEST_RECORDS, JSON.stringify({ method, url: path, body }) + '\\n');
}

globalThis.fetch = async (input, options = {}) => {
  const url = new URL(String(input));
  const path = url.pathname;
  const method = options.method ?? 'GET';
  const body = options.body ? JSON.parse(String(options.body)) : undefined;
  record(method, path, body);

  if (path === '/api/gateway/sessions' && method === 'GET') {
    return Response.json({ sessions });
  }
  if (path === '/api/setup/status') {
    return Response.json({
      channelWorkspaces: [{ id: 'workspace-1', provider: 'slack', externalWorkspaceId: 'T1', name: 'Acme' }],
      slack: { workspace: { id: 'workspace-1', provider: 'slack', externalWorkspaceId: 'T1', name: 'Acme' } },
      discord: {},
      provider: { configured: true, defaultProvider: 'openai' }
    });
  }
  if (path === '/api/setup/defaults') {
    return Response.json({
      ok: true,
      defaults: {
        workspaceOwners: [{ workspaceId: 'workspace-1', ownerUserId: 'U1' }],
        workspaceChannels: [{
          workspaceId: 'workspace-1',
          channelScopeMode: 'selected',
          selectedChannels: [{ id: 'C1', displayName: '#support' }]
        }]
      }
    });
  }
  if (path === '/api/gateway/sessions/bulk' && method === 'POST') {
    return Response.json({ ok: true, sessions: [{ ...sessions[0], id: 'session-new', title: 'CLI monitor' }] }, { status: 201 });
  }
  if (path.startsWith('/api/gateway/sessions/') && path.endsWith('/stop') && method === 'POST') {
    const id = path.split('/')[4];
    return Response.json({ ok: true, session: { id, status: 'stopped' } });
  }
  return Response.json({ ok: false, error: 'not_found' }, { status: 404 });
};
`);
  return { root, toolsDir, recordsPath, mockFetchPath };
}

function readRecords(path: string): Array<{ method: string; url: string; body?: unknown }> {
  try {
    return readFileSync(path, 'utf8')
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch {
    return [];
  }
}

function runMonitor(args: string[], fixture = createFixture()) {
  const result = spawnSync('bash', [repoCli, 'monitor', ...args], {
    cwd: repoRoot,
    env: {
      ...process.env,
      HOME: fixture.root,
      MURPH_HOME: join(fixture.root, '.murph'),
      MURPH_URL: 'http://murph.test',
      MURPH_TEST_RECORDS: fixture.recordsPath,
      NODE_OPTIONS: `--import ${fixture.mockFetchPath}`,
      PATH: `${fixture.toolsDir}:${process.env.PATH ?? ''}`
    },
    encoding: 'utf8'
  });
  return { result, records: readRecords(fixture.recordsPath) };
}

describe('murph monitor CLI', () => {
  it('defaults to status', () => {
    const { result } = runMonitor([]);

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('Active coverage sessions: 2');
  });

  it('prints active coverage sessions', () => {
    const { result } = runMonitor(['status']);

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('Active coverage sessions: 2');
    expect(result.stdout).toContain('session-1');
  });

  it('starts coverage from setup defaults with flag overrides', () => {
    const { result, records } = runMonitor(['start', '--duration', '4', '--mode', 'dry_run', '--channels', 'C2,C3']);

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('Started 1 coverage session.');
    const request = records.find((entry) => entry.url === '/api/gateway/sessions/bulk');
    expect(request?.body).toMatchObject({
      durationHours: 4,
      mode: 'dry_run',
      targets: [{ workspaceId: 'workspace-1', ownerUserId: 'U1', channelScope: ['C2', 'C3'] }]
    });
  });

  it('requires an explicit stop target when multiple sessions are active', () => {
    const { result } = runMonitor(['stop']);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('Multiple active sessions found');
  });

  it('stops all sessions with --all', () => {
    const { result, records } = runMonitor(['stop', '--all']);

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('Stopped 2 coverage sessions.');
    expect(records.filter((entry) => entry.url.endsWith('/stop'))).toHaveLength(2);
  });
});
