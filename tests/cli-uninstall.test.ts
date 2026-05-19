import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  symlinkSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

const repoRoot = process.cwd();
const repoCli = join(repoRoot, 'bin/murph');

function runMurph(args: string[], env: Record<string, string>) {
  return spawnSync('bash', [repoCli, ...args], {
    cwd: repoRoot,
    env: {
      ...process.env,
      ...env,
      MURPH_URL: 'http://127.0.0.1:9'
    },
    encoding: 'utf8'
  });
}

function writeAppFixture(appDir: string): void {
  mkdirSync(join(appDir, 'bin'), { recursive: true });
  writeFileSync(join(appDir, 'package.json'), '{"name":"murph","version":"0.0.0"}\n');
  copyFileSync(repoCli, join(appDir, 'bin/murph'));
  chmodSync(join(appDir, 'bin/murph'), 0o755);
}

function createInstalledFixture() {
  const home = mkdtempSync(join(tmpdir(), 'murph-uninstall-home-'));
  const murphHome = join(home, '.murph');
  const appDir = join(murphHome, 'app');
  const binDir = join(home, '.local/bin');
  writeAppFixture(appDir);
  mkdirSync(join(appDir, 'data'), { recursive: true });
  mkdirSync(join(murphHome, 'deps/bin'), { recursive: true });
  mkdirSync(binDir, { recursive: true });
  writeFileSync(join(murphHome, '.credentials'), '{"version":1,"credentials":[]}\n');
  writeFileSync(join(murphHome, 'config.yaml'), 'app:\n  sqlitePath: data/murph.sqlite\n');
  writeFileSync(join(murphHome, 'murph.log'), 'log\n');
  writeFileSync(join(murphHome, 'murph.pid'), '999999\n');
  writeFileSync(join(appDir, 'data/murph.sqlite'), '');
  symlinkSync(join(appDir, 'bin/murph'), join(binDir, 'murph'));

  return {
    home,
    murphHome,
    appDir,
    binDir,
    env: {
      HOME: home,
      MURPH_HOME: murphHome,
      MURPH_APP_DIR: appDir,
      MURPH_BIN_DIR: binDir
    }
  };
}

describe('murph uninstall', () => {
  it('shows default install removals without deleting during dry run', () => {
    const fixture = createInstalledFixture();

    const result = runMurph(['uninstall', '--dry-run'], fixture.env);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Dry run complete');
    expect(result.stdout).toContain(fixture.murphHome);
    expect(existsSync(fixture.murphHome)).toBe(true);
    expect(existsSync(join(fixture.binDir, 'murph'))).toBe(true);
    expect(existsSync(join(fixture.appDir, 'data/murph.sqlite'))).toBe(true);
  });

  it('removes the default install so install can start clean again', () => {
    const fixture = createInstalledFixture();

    const result = runMurph(['uninstall', '--yes'], fixture.env);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Murph uninstall complete');
    expect(existsSync(fixture.murphHome)).toBe(false);
    expect(existsSync(join(fixture.binDir, 'murph'))).toBe(false);
    expect(existsSync(fixture.appDir)).toBe(false);
  });

  it('rejects ambiguous custom home paths before removing files', () => {
    const fixture = createInstalledFixture();
    const unsafeHome = join(fixture.home, 'state');
    mkdirSync(unsafeHome, { recursive: true });

    const result = runMurph(['uninstall', '--yes'], {
      ...fixture.env,
      MURPH_HOME: unsafeHome
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('not clearly Murph-owned');
    expect(existsSync(unsafeHome)).toBe(true);
    expect(existsSync(join(fixture.binDir, 'murph'))).toBe(true);
    expect(existsSync(join(fixture.appDir, 'data/murph.sqlite'))).toBe(true);
  });

  it('keeps a source checkout while removing generated local files', () => {
    const root = mkdtempSync(join(tmpdir(), 'murph-uninstall-source-'));
    const home = join(root, 'home');
    const sourceDir = join(root, 'source');
    const murphHome = join(home, '.murph');
    const binDir = join(home, '.local/bin');
    writeAppFixture(sourceDir);
    mkdirSync(join(sourceDir, 'data'), { recursive: true });
    mkdirSync(murphHome, { recursive: true });
    mkdirSync(binDir, { recursive: true });
    writeFileSync(join(sourceDir, '.murph-install.log'), 'install log\n');
    writeFileSync(join(sourceDir, 'data/murph.sqlite'), '');
    writeFileSync(join(murphHome, '.credentials'), '{"version":1,"credentials":[]}\n');
    writeFileSync(join(murphHome, 'config.yaml'), 'app:\n  sqlitePath: data/murph.sqlite\n');
    symlinkSync(join(sourceDir, 'bin/murph'), join(binDir, 'murph'));

    const result = spawnSync('bash', [join(sourceDir, 'bin/murph'), 'uninstall', '--yes'], {
      cwd: sourceDir,
      env: {
        ...process.env,
        HOME: home,
        MURPH_HOME: murphHome,
        MURPH_BIN_DIR: binDir,
        MURPH_URL: 'http://127.0.0.1:9'
      },
      encoding: 'utf8'
    });

    expect(result.status).toBe(0);
    expect(existsSync(sourceDir)).toBe(true);
    expect(existsSync(join(sourceDir, 'package.json'))).toBe(true);
    expect(existsSync(join(sourceDir, 'data'))).toBe(false);
    expect(existsSync(join(sourceDir, '.murph-install.log'))).toBe(false);
    expect(existsSync(murphHome)).toBe(false);
    expect(existsSync(join(binDir, 'murph'))).toBe(false);
  });
});
