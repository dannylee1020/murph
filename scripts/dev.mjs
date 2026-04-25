#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process';

const processes = [];

function run(command, args) {
  const child = spawn(command, args, {
    stdio: 'inherit',
    shell: process.platform === 'win32'
  });
  processes.push(child);
  child.on('exit', (code) => {
    if (code && !shuttingDown) {
      process.exit(code);
    }
  });
}

let shuttingDown = false;

function shutdown() {
  shuttingDown = true;
  for (const child of processes) {
    child.kill();
  }
}

process.on('SIGINT', () => {
  shutdown();
  process.exit(0);
});
process.on('SIGTERM', () => {
  shutdown();
  process.exit(0);
});

const initialBuild = spawnSync('npm', ['run', 'build:server'], { stdio: 'inherit' });
if ((initialBuild.status ?? 1) !== 0) {
  process.exit(initialBuild.status ?? 1);
}

run('npm', ['run', 'watch:server']);
run('node', ['--watch', 'dist/server/index.js']);
run('npm', ['run', 'dev:ui']);
