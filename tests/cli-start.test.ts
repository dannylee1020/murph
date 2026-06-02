import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

const repoRoot = process.cwd();
const repoCli = join(repoRoot, 'shared/cli/murph');

function createAppFixture() {
  const root = mkdtempSync(join(tmpdir(), 'murph-cli-start-'));
  const appDir = join(root, 'app');
  const murphHome = join(root, '.murph');
  const toolsDir = join(root, 'tools');
  mkdirSync(join(appDir, 'dist/app/team/runtime'), { recursive: true });
  mkdirSync(join(appDir, 'dist/app/personal/runtime'), { recursive: true });
  mkdirSync(murphHome, { recursive: true });
  mkdirSync(toolsDir, { recursive: true });
  writeFileSync(join(appDir, 'package.json'), '{"name":"murph","version":"0.0.0"}\n');
  writeFileSync(join(appDir, 'dist/app/team/runtime/server.js'), 'require("node:fs").writeFileSync(process.env.MURPH_STARTED_FILE, process.env.MURPH_DISTRIBUTION || "");\n');
  writeFileSync(join(appDir, 'dist/app/personal/runtime/server.js'), 'require("node:fs").writeFileSync(process.env.MURPH_STARTED_FILE, process.env.MURPH_DISTRIBUTION || "");\n');
  writeFileSync(join(toolsDir, 'curl'), '#!/usr/bin/env bash\nprintf "%s" "$FAKE_HEALTH_PAYLOAD"\n');
  writeFileSync(join(toolsDir, 'lsof'), '#!/usr/bin/env bash\nprintf "12345\\n"\n');
  chmodSync(join(toolsDir, 'curl'), 0o755);
  chmodSync(join(toolsDir, 'lsof'), 0o755);

  return { root, appDir, murphHome, toolsDir };
}

function runMurph(args: string[], env: Record<string, string>, cli = repoCli) {
  return spawnSync('bash', [cli, ...args], {
    cwd: repoRoot,
    env: {
      ...process.env,
      ...env,
      PATH: `${env.PATH}:${process.env.PATH}`
    },
    encoding: 'utf8'
  });
}

describe('murph start port preflight', () => {
  it('reuses an existing Murph server', () => {
    const fixture = createAppFixture();
    const port = 5291;

    const result = runMurph(['start', '--background'], {
      HOME: fixture.root,
      MURPH_HOME: fixture.murphHome,
      MURPH_APP_DIR: fixture.appDir,
      MURPH_PORT: String(port),
      MURPH_URL: `http://127.0.0.1:${port}`,
      FAKE_HEALTH_PAYLOAD: '{"ok":true,"service":"murph"}',
      PATH: fixture.toolsDir
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain(`Murph is already running at http://127.0.0.1:${port}`);
  });

  it('fails clearly when a non-Murph server owns the configured port', () => {
    const fixture = createAppFixture();
    const port = 5292;

    const result = runMurph(['start', '--background'], {
      HOME: fixture.root,
      MURPH_HOME: fixture.murphHome,
      MURPH_APP_DIR: fixture.appDir,
      MURPH_PORT: String(port),
      MURPH_URL: `http://127.0.0.1:${port}`,
      FAKE_HEALTH_PAYLOAD: '{"ok":true,"service":"other"}',
      PATH: fixture.toolsDir
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(`Port ${port} is already in use`);
    expect(result.stderr).toContain('not a Murph server');
    expect(result.stderr).toContain('OAuth callback URLs');
  });

  it('starts the personal runtime for a personal product install', () => {
    const fixture = createAppFixture();
    const startedFile = join(fixture.root, 'started.txt');
    writeFileSync(join(fixture.toolsDir, 'curl'), '#!/usr/bin/env bash\nexit 1\n');
    writeFileSync(join(fixture.toolsDir, 'lsof'), '#!/usr/bin/env bash\nexit 1\n');
    chmodSync(join(fixture.toolsDir, 'curl'), 0o755);
    chmodSync(join(fixture.toolsDir, 'lsof'), 0o755);

    const result = runMurph(['start'], {
      HOME: fixture.root,
      MURPH_HOME: fixture.murphHome,
      MURPH_APP_DIR: fixture.appDir,
      MURPH_DISTRIBUTION: 'personal',
      MURPH_PORT: '5293',
      MURPH_URL: 'http://127.0.0.1:5293',
      MURPH_STARTED_FILE: startedFile,
      FAKE_HEALTH_PAYLOAD: '',
      PATH: fixture.toolsDir
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Starting Murph personal');
    expect(readFileSync(startedFile, 'utf8')).toBe('personal');
  });

  it('starts the team runtime by default', () => {
    const fixture = createAppFixture();
    const startedFile = join(fixture.root, 'started-team.txt');
    writeFileSync(join(fixture.toolsDir, 'curl'), '#!/usr/bin/env bash\nexit 1\n');
    writeFileSync(join(fixture.toolsDir, 'lsof'), '#!/usr/bin/env bash\nexit 1\n');
    chmodSync(join(fixture.toolsDir, 'curl'), 0o755);
    chmodSync(join(fixture.toolsDir, 'lsof'), 0o755);

    const result = runMurph(['start'], {
      HOME: fixture.root,
      MURPH_HOME: fixture.murphHome,
      MURPH_APP_DIR: fixture.appDir,
      MURPH_PORT: '5294',
      MURPH_URL: 'http://127.0.0.1:5294',
      MURPH_STARTED_FILE: startedFile,
      FAKE_HEALTH_PAYLOAD: '',
      PATH: fixture.toolsDir
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Starting Murph team');
    expect(readFileSync(startedFile, 'utf8')).toBe('team');
  });

  it('does not expose team admin commands from a personal product install', () => {
    const fixture = createAppFixture();

    const result = runMurph(['admin', 'subscribers'], {
      HOME: fixture.root,
      MURPH_HOME: fixture.murphHome,
      MURPH_APP_DIR: fixture.appDir,
      MURPH_DISTRIBUTION: 'personal',
      MURPH_PORT: '5295',
      MURPH_URL: 'http://127.0.0.1:5295',
      MURPH_STARTED_FILE: join(fixture.root, 'unused.txt'),
      FAKE_HEALTH_PAYLOAD: '',
      PATH: fixture.toolsDir
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('Murph Personal does not include the Team admin dashboard.');
  });
});
