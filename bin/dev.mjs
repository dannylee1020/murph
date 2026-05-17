import { spawn } from 'node:child_process';

const isWindows = process.platform === 'win32';
const npm = isWindows ? 'npm.cmd' : 'npm';
const children = new Set();
let shuttingDown = false;

function start(name, args) {
  const child = spawn(npm, args, {
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

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

start('server', ['run', 'dev:server']);
start('ui', ['run', 'dev:ui']);
