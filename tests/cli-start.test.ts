import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

const repoRoot = process.cwd();
const repoCli = join(repoRoot, 'bin/murph');

function createAppFixture() {
  const root = mkdtempSync(join(tmpdir(), 'murph-cli-start-'));
  const appDir = join(root, 'app');
  const murphHome = join(root, '.murph');
  const toolsDir = join(root, 'tools');
  mkdirSync(join(appDir, 'dist/server'), { recursive: true });
  mkdirSync(murphHome, { recursive: true });
  mkdirSync(toolsDir, { recursive: true });
  writeFileSync(join(appDir, 'package.json'), '{"name":"murph","version":"0.0.0"}\n');
  writeFileSync(join(appDir, 'dist/server/index.js'), 'setInterval(() => {}, 1000);\n');
  writeFileSync(join(toolsDir, 'curl'), '#!/usr/bin/env bash\nprintf "%s" "$FAKE_HEALTH_PAYLOAD"\n');
  writeFileSync(join(toolsDir, 'lsof'), '#!/usr/bin/env bash\nprintf "12345\\n"\n');
  chmodSync(join(toolsDir, 'curl'), 0o755);
  chmodSync(join(toolsDir, 'lsof'), 0o755);

  return { root, appDir, murphHome, toolsDir };
}

function runMurph(args: string[], env: Record<string, string>) {
  return spawnSync('bash', [repoCli, ...args], {
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
});
