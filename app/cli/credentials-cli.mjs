#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { parse } from 'yaml';

const appDir = process.env.MURPH_APP_DIR || process.cwd();
const murphHome = process.env.MURPH_HOME || path.join(homedir(), '.murph');
const credentialsPath = process.env.MURPH_CREDENTIALS_PATH || path.join(murphHome, '.credentials');
const configPath = process.env.MURPH_CONFIG_PATH || path.join(murphHome, 'config.yaml');

function usage() {
  console.log(`Usage: murph credentials <command>

Commands:
  list             Show local credential records without revealing values.
  doctor           Check the local credential store.
`);
}

function readCredentialFile() {
  if (!existsSync(credentialsPath)) return { version: 1, credentials: [] };
  const raw = readFileSync(credentialsPath, 'utf8').trim();
  if (!raw) return { version: 1, credentials: [] };
  const parsed = JSON.parse(raw);
  return { version: 1, credentials: Array.isArray(parsed.credentials) ? parsed.credentials : [] };
}

function mask(value) {
  const text = String(value || '');
  return text.length <= 4 ? '****' : `****${text.slice(-4)}`;
}

function sqlitePath() {
  if (process.env.MURPH_SQLITE_PATH) {
    return path.resolve(appDir, process.env.MURPH_SQLITE_PATH);
  }
  if (existsSync(configPath)) {
    const config = parse(readFileSync(configPath, 'utf8')) || {};
    if (config?.app?.sqlitePath) {
      return path.resolve(appDir, config.app.sqlitePath);
    }
  }
  return path.resolve(appDir, 'data/murph.sqlite');
}

function list() {
  const file = readCredentialFile();
  if (file.credentials.length === 0) {
    console.log(`No credentials found at ${credentialsPath}`);
    return;
  }
  for (const entry of file.credentials) {
    const scope = [
      entry.workspaceId ? `workspace=${entry.workspaceId}` : '',
      entry.externalWorkspaceId ? `external=${entry.externalWorkspaceId}` : '',
      entry.userId ? `user=${entry.userId}` : ''
    ].filter(Boolean).join(' ');
    console.log(`${entry.provider}.${entry.key} ${mask(entry.value)} ${scope}`.trim());
  }
}

function doctor() {
  const file = readCredentialFile();
  console.log(`Credentials file: ${credentialsPath}`);
  console.log(`Stored credentials: ${file.credentials.length}`);
  console.log(`SQLite path: ${sqlitePath()}`);
}

const command = process.argv[2] || 'help';
if (command === 'list') {
  list();
} else if (command === 'doctor') {
  doctor();
} else {
  usage();
  if (command !== 'help' && command !== '-h' && command !== '--help') process.exitCode = 1;
}
