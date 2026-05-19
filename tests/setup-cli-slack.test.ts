import { chmodSync, existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

const repoRoot = process.cwd();
const setupCli = path.join(repoRoot, 'bin/setup-cli.mjs');
const manifest = [
  'display_information:',
  '  name: Murph',
  'oauth_config:',
  '  redirect_urls:',
  '    - http://localhost:5173/api/slack/oauth/callback',
  '  scopes:',
  '    bot:',
  '      - chat:write',
  'settings:',
  '  socket_mode_enabled: true',
  ''
].join('\n');

function createAppDir(): string {
  const appDir = mkdtempSync(path.join(tmpdir(), 'murph-setup-cli-'));
  mkdirSync(path.join(appDir, 'docs/public'), { recursive: true });
  writeFileSync(path.join(appDir, 'docs/public/slack-manifest.yaml'), manifest);
  return appDir;
}

function createFetchMock(
  appDir: string,
  slackPayload: unknown,
  setupStatusPayloads: unknown[] = [{ ok: true, slack: { installed: true } }]
): { callsPath: string; mockPath: string; setupStatusesPath: string } {
  const callsPath = path.join(appDir, 'fetch-calls.jsonl');
  const payloadPath = path.join(appDir, 'slack-payload.json');
  const setupStatusesPath = path.join(appDir, 'setup-status-payloads.json');
  const mockPath = path.join(appDir, 'mock-fetch.mjs');
  writeFileSync(payloadPath, JSON.stringify(slackPayload));
  writeFileSync(setupStatusesPath, JSON.stringify(setupStatusPayloads));
  writeFileSync(mockPath, `
import { appendFileSync, readFileSync } from 'node:fs';

const callsPath = process.env.MOCK_FETCH_CALLS;
const slackPayload = JSON.parse(readFileSync(process.env.MOCK_SLACK_PAYLOAD, 'utf8'));
const setupStatusPayloads = JSON.parse(readFileSync(process.env.MOCK_SETUP_STATUSES, 'utf8'));
let setupStatusIndex = 0;

globalThis.fetch = async (url, options = {}) => {
  appendFileSync(callsPath, JSON.stringify({
    url: String(url),
    method: options.method || 'GET',
    body: options.body ? JSON.parse(String(options.body)) : undefined
  }) + '\\n');
  if (String(url).includes('/api/health')) {
    return Response.json({ ok: true });
  }
  if (String(url).includes('/api/setup/config')) {
    return Response.json({ ok: true, updated: [] });
  }
  if (String(url).includes('/api/setup/status')) {
    const payload = setupStatusPayloads[Math.min(setupStatusIndex, setupStatusPayloads.length - 1)];
    setupStatusIndex += 1;
    return Response.json(payload);
  }
  if (String(url).includes('/api/setup/doctor')) {
    return Response.json({
      ok: true,
      ready: false,
      nextStep: 'identity',
      checks: [
        { id: 'config_file', label: 'Config file', status: 'ok', message: 'Configured.' },
        { id: 'identity', label: 'User identity', status: 'action_required', message: 'Pick yourself from Slack.' }
      ]
    });
  }
  if (String(url).includes('/api/setup/defaults')) {
    return Response.json({ ok: true, defaults: {} });
  }
  if (String(url).includes('/apps.manifest.create') || String(url).includes('/apps.manifest.update')) {
    return Response.json(slackPayload);
  }
  return Response.json({ ok: false, error: 'not_found' }, { status: 404 });
};
`);
  return { callsPath, mockPath, setupStatusesPath };
}

function createSlackCliMock(appDir: string, authListOutput: string): string {
  const binDir = path.join(appDir, 'bin');
  mkdirSync(binDir, { recursive: true });
  const slackPath = path.join(binDir, 'slack');
  writeFileSync(slackPath, [
    '#!/bin/sh',
    'if [ "$1" = "auth" ] && [ "$2" = "list" ]; then',
    `  cat <<'EOF'`,
    authListOutput,
    'EOF',
    '  exit 0',
    'fi',
    'if [ "$1" = "app" ] && [ "$2" = "settings" ]; then',
    `  echo called > '${path.join(appDir, 'slack-app-settings-called')}'`,
    '  exit 99',
    'fi',
    'exit 0',
    ''
  ].join('\n'));
  chmodSync(slackPath, 0o755);
  return binDir;
}

function createBrowserOpenMock(appDir: string): { command: string; openedUrlPath: string } {
  const binDir = path.join(appDir, 'bin');
  mkdirSync(binDir, { recursive: true });
  const openedUrlPath = path.join(appDir, 'browser-open-url');
  const command = path.join(binDir, 'open-browser');
  writeFileSync(command, [
    '#!/bin/sh',
    `printf '%s\\n' "$1" > '${openedUrlPath}'`,
    ''
  ].join('\n'));
  chmodSync(command, 0o755);
  return { command, openedUrlPath };
}

function readCalls(callsPath: string): Array<{ url: string; method: string; body?: Record<string, unknown> }> {
  if (!existsSync(callsPath)) return [];
  return readFileSync(callsPath, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function runSetupSlack(
  appDir: string,
  input: string,
  slackPayload: unknown,
  options: { args?: string[]; env?: Record<string, string>; slackAuthList?: string; setupStatusPayloads?: unknown[]; browserOpen?: boolean } = {}
) {
  const { callsPath, mockPath, setupStatusesPath } = createFetchMock(appDir, slackPayload, options.setupStatusPayloads);
  const slackCliPath = options.slackAuthList === undefined ? undefined : createSlackCliMock(appDir, options.slackAuthList);
  const browserOpen = options.browserOpen ? createBrowserOpenMock(appDir) : null;
  const result = spawnSync(process.execPath, ['--import', mockPath, setupCli, ...(options.args ?? ['slack'])], {
    cwd: repoRoot,
    input,
    env: {
      ...process.env,
      MURPH_APP_DIR: appDir,
      MURPH_CONFIG_PATH: path.join(appDir, 'config.yaml'),
      MURPH_CREDENTIALS_PATH: path.join(appDir, '.credentials'),
      MURPH_URL: 'http://murph.test',
      MURPH_SLACK_API_BASE: 'http://slack.test/api',
      MOCK_FETCH_CALLS: callsPath,
      MOCK_SLACK_PAYLOAD: path.join(appDir, 'slack-payload.json'),
      MOCK_SETUP_STATUSES: setupStatusesPath,
      MURPH_SLACK_CONFIG_TOKEN: '',
      MURPH_BROWSER_OPEN_COMMAND: browserOpen?.command ?? '',
      PATH: slackCliPath ? `${slackCliPath}:/usr/bin:/bin` : '/usr/bin:/bin',
      ...(options.env ?? {})
    },
    encoding: 'utf8'
  });
  return { result, calls: readCalls(callsPath), openedUrlPath: browserOpen?.openedUrlPath };
}

describe('setup CLI Slack app setup', () => {
  it('creates Slack app config from a manifest configuration token', async () => {
    const appDir = createAppDir();
    const { result, calls } = runSetupSlack(appDir, 'xoxe-config\n', {
      ok: true,
      app_id: 'A123',
      credentials: {
        client_id: 'client-id',
        client_secret: 'client-secret',
        signing_secret: 'signing-secret',
        app_token: 'xapp-returned'
      }
    }, {
      env: { SLACK_TEAM_ID: 'T123', SLACK_TEAM_NAME: 'Murph Test Workspace' }
    });

    expect(result.status, result.stderr + result.stdout).toBe(0);
    const manifestCall = calls.find((call) => call.url.includes('/apps.manifest.create'));
    expect(manifestCall).toBeTruthy();
    expect(typeof manifestCall?.body?.manifest).toBe('string');
    expect(JSON.parse(String(manifestCall?.body?.manifest)).settings.socket_mode_enabled).toBe(true);
    expect(readFileSync(path.join(appDir, 'config.yaml'), 'utf8')).toContain('appId: A123');
    expect(readFileSync(path.join(appDir, 'config.yaml'), 'utf8')).toContain('clientId: client-id');
    expect(readFileSync(path.join(appDir, 'config.yaml'), 'utf8')).not.toContain('xoxe-config');
    const credentials = JSON.parse(readFileSync(path.join(appDir, '.credentials'), 'utf8'));
    expect(credentials.credentials).toEqual(expect.arrayContaining([
      expect.objectContaining({ provider: 'slack', key: 'app_token', value: 'xapp-returned' }),
      expect.objectContaining({ provider: 'slack', key: 'client_secret', value: 'client-secret' }),
      expect.objectContaining({ provider: 'slack', key: 'signing_secret', value: 'signing-secret' })
    ]));
  });

  it('prints Slack app settings URL instead of calling Slack CLI app settings', async () => {
    const appDir = createAppDir();
    const { result } = runSetupSlack(appDir, 'xapp-manual\n', {
      ok: true,
      app_id: 'A123',
      credentials: {
        client_id: 'client-id',
        client_secret: 'client-secret'
      }
    }, {
      slackAuthList: 'Murph Test Workspace T123\n',
      env: { MURPH_SLACK_CONFIG_TOKEN: 'xoxe-config' }
    });

    expect(result.status, result.stderr + result.stdout).toBe(0);
    expect(result.stdout).toContain('https://api.slack.com/apps/A123/general');
    expect(result.stdout).toContain('Create or copy the app-level token');
    expect(result.stdout).not.toContain('Slack CLI could not open app settings');
    expect(existsSync(path.join(appDir, 'slack-app-settings-called'))).toBe(false);
  });

  it('opens and prints a CLI-sourced Slack install URL before returning to the CLI', async () => {
    const appDir = createAppDir();
    const { result, openedUrlPath } = runSetupSlack(appDir, '\n', {
      ok: true,
      app_id: 'A123',
      credentials: {
        client_id: 'client-id',
        client_secret: 'client-secret',
        app_token: 'xapp-returned'
      }
    }, {
      env: { MURPH_SLACK_CONFIG_TOKEN: 'xoxe-config', SLACK_TEAM_ID: 'T123', SLACK_TEAM_NAME: 'Murph Test Workspace' },
      browserOpen: true,
      setupStatusPayloads: [
        { ok: true, slack: { installed: false } },
        { ok: true, slack: { installed: true, workspace: { externalWorkspaceId: 'T123', name: 'Murph Test Workspace' } } }
      ]
    });

    expect(result.status, result.stderr + result.stdout).toBe(0);
    expect(result.stdout).toContain('http://murph.test/api/slack/install?source=cli&team=T123');
    expect(result.stdout).toContain('Opening this URL to install Murph');
    expect(result.stdout).toContain('Press Enter after Slack app installation finishes.');
    expect(readFileSync(openedUrlPath!, 'utf8').trim()).toBe('http://murph.test/api/slack/install?source=cli&team=T123');
  });

  it('lets the user select one Slack CLI workspace when multiple are available', async () => {
    const appDir = createAppDir();
    const { result } = runSetupSlack(appDir, '2\n', {
      ok: true,
      app_id: 'A123',
      credentials: {
        client_id: 'client-id',
        client_secret: 'client-secret',
        app_token: 'xapp-returned'
      }
    }, {
      slackAuthList: 'First Workspace T111\nSecond Workspace T222\n',
      env: { MURPH_SLACK_CONFIG_TOKEN: 'xoxe-config' }
    });

    expect(result.status, result.stderr + result.stdout).toBe(0);
    const config = readFileSync(path.join(appDir, 'config.yaml'), 'utf8');
    expect(config).toContain('teamId: T222');
    expect(config).toContain('teamName: Second Workspace');
  });

  it('does not send a pasted app-level token to Slack Manifest APIs', async () => {
    const appDir = createAppDir();
    const { result, calls } = runSetupSlack(appDir, '', { ok: false, error: 'should_not_be_called' }, {
      args: ['slack', '--non-interactive'],
      env: { MURPH_SLACK_CONFIG_TOKEN: 'xapp-mistaken' }
    });

    expect(result.status).not.toBe(0);
    expect(calls.some((call) => call.url.includes('/apps.manifest'))).toBe(false);
    const credentials = JSON.parse(readFileSync(path.join(appDir, '.credentials'), 'utf8'));
    expect(credentials.credentials).toEqual(expect.arrayContaining([
      expect.objectContaining({ provider: 'slack', key: 'app_token', value: 'xapp-mistaken' })
    ]));
  });

  it('keeps setup status JSON output machine-readable', async () => {
    const appDir = createAppDir();
    const { result } = runSetupSlack(appDir, '', { ok: true }, {
      args: ['status', '--json'],
      env: {
        FORCE_COLOR: '1',
        COLORTERM: 'truecolor',
        NO_COLOR: ''
      }
    });

    expect(result.status, result.stderr + result.stdout).toBe(0);
    expect(result.stdout).not.toContain('\u001b[');
    const payload = JSON.parse(result.stdout);
    expect(payload.ok).toBe(true);
    expect(payload.local).toBeTruthy();
    expect(payload.server.doctor.nextStep).toBe('identity');
  });
});
