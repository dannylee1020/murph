import { spawn, spawnSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const isWindows = process.platform === 'win32';
const tsc = isWindows ? 'tsc.cmd' : 'tsc';
const vite = isWindows ? 'vite.cmd' : 'vite';
const children = new Set();
const serverEntry = 'dist/app/runtime/server.js';
let shuttingDown = false;
let serverChild = null;
let restartingServer = false;
let restartTimer = null;
let serverPoller = null;
let serverBuildSnapshot = '';

function runInitialServerBuild() {
  const result = spawnSync(tsc, ['-p', 'tsconfig.server.json'], {
    stdio: 'inherit',
    env: process.env
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function start(name, command, args) {
  const child = spawn(command, args, {
    stdio: 'inherit',
    env: process.env
  });

  children.add(child);

  child.on('exit', (code, signal) => {
    children.delete(child);
    if (shuttingDown) return;

    if (code === 0 || signal === 'SIGTERM' || signal === 'SIGINT') {
      shutdown(0);
      return;
    }

    console.error(`${name} exited with ${signal ?? `code ${code ?? 1}`}`);
    shutdown(code ?? 1);
  });
}

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;

  if (restartTimer) {
    clearTimeout(restartTimer);
    restartTimer = null;
  }

  if (serverPoller) {
    clearInterval(serverPoller);
    serverPoller = null;
  }

  for (const child of children) {
    child.kill('SIGTERM');
  }

  setTimeout(() => {
    for (const child of children) {
      child.kill('SIGKILL');
    }
    process.exit(code);
  }, 1000).unref();

  if (children.size === 0) {
    process.exit(code);
  }
}

function startServer() {
  const child = spawn(process.execPath, [serverEntry], {
    stdio: 'inherit',
    env: process.env
  });

  serverChild = child;
  children.add(child);

  child.on('exit', (code, signal) => {
    children.delete(child);
    if (serverChild === child) {
      serverChild = null;
    }

    if (shuttingDown || restartingServer) return;

    if (code === 0 || signal === 'SIGTERM' || signal === 'SIGINT') {
      shutdown(0);
      return;
    }

    console.error(`server exited with ${signal ?? `code ${code ?? 1}`}`);
    shutdown(code ?? 1);
  });
}

function restartServer() {
  if (shuttingDown) return;

  if (restartTimer) {
    clearTimeout(restartTimer);
  }

  restartTimer = setTimeout(() => {
    restartTimer = null;
    if (shuttingDown) return;

    if (!serverChild) {
      startServer();
      return;
    }

    restartingServer = true;
    const child = serverChild;
    child.once('exit', () => {
      restartingServer = false;
      if (!shuttingDown) {
        startServer();
      }
    });
    child.kill('SIGTERM');

    setTimeout(() => {
      if (serverChild === child) {
        child.kill('SIGKILL');
      }
    }, 1000).unref();
  }, 150);
}

function collectServerBuildSnapshot(dir, entries = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      collectServerBuildSnapshot(path, entries);
      continue;
    }

    if (!entry.isFile() || !entry.name.endsWith('.js')) continue;
    const stat = statSync(path);
    entries.push(`${path}:${stat.mtimeMs}:${stat.size}`);
  }

  return entries.sort().join('\n');
}

function watchServerBuild() {
  serverBuildSnapshot = collectServerBuildSnapshot('dist/app');
  serverPoller = setInterval(() => {
    let nextSnapshot;
    try {
      nextSnapshot = collectServerBuildSnapshot('dist/app');
    } catch (error) {
      console.error(`server watcher failed: ${error.message}`);
      shutdown(1);
      return;
    }

    if (nextSnapshot !== serverBuildSnapshot) {
      serverBuildSnapshot = nextSnapshot;
      restartServer();
    }
  }, 500);

  serverPoller.unref();
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

runInitialServerBuild();
start('server:types', tsc, ['-p', 'tsconfig.server.json', '--watch', '--preserveWatchOutput']);
watchServerBuild();
startServer();
start('ui', vite, ['--config', 'app/ui/vite.config.ts']);
