#!/usr/bin/env node
import { createDecipheriv, createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { parse } from 'yaml';

const appDir = process.env.MURPH_APP_DIR || process.cwd();
const murphHome = process.env.MURPH_HOME || path.join(homedir(), '.murph');
const credentialsPath = process.env.MURPH_CREDENTIALS_PATH || path.join(murphHome, '.credentials');
const envPath = path.join(appDir, '.env');
const configPath = path.join(appDir, 'murph.config.yaml');

const SECRET_KEY_MAP = {
  OPENAI_API_KEY: ['openai', 'api_key'],
  ANTHROPIC_API_KEY: ['anthropic', 'api_key'],
  SLACK_APP_TOKEN: ['slack', 'app_token'],
  SLACK_CLIENT_SECRET: ['slack', 'client_secret'],
  SLACK_SIGNING_SECRET: ['slack', 'signing_secret'],
  DISCORD_BOT_TOKEN: ['discord', 'bot_token'],
  DISCORD_CLIENT_SECRET: ['discord', 'client_secret'],
  GOOGLE_ACCESS_TOKEN: ['google', 'access_token'],
  GOOGLE_CLIENT_SECRET: ['google', 'client_secret'],
  GITHUB_PAT: ['github', 'api_key'],
  NOTION_API_KEY: ['notion', 'api_key'],
  GRANOLA_API_KEY: ['granola', 'api_key'],
  TAVILY_API_KEY: ['tavily', 'api_key'],
  BRAVE_SEARCH_API_KEY: ['brave_search', 'api_key']
};

function usage() {
  console.log(`Usage: murph credentials <command>

Commands:
  list             Show local credential records without revealing values.
  doctor           Check the local credential store and legacy secret locations.
  migrate          Copy secrets from .env and legacy SQLite into ~/.murph/.credentials.
  cleanup-legacy   Remove known secret keys from the repo-local .env file.
`);
}

function readCredentialFile() {
  if (!existsSync(credentialsPath)) return { version: 1, credentials: [] };
  const raw = readFileSync(credentialsPath, 'utf8').trim();
  if (!raw) return { version: 1, credentials: [] };
  const parsed = JSON.parse(raw);
  return { version: 1, credentials: Array.isArray(parsed.credentials) ? parsed.credentials : [] };
}

function writeCredentialFile(file) {
  mkdirSync(path.dirname(credentialsPath), { recursive: true, mode: 0o700 });
  writeFileSync(credentialsPath, `${JSON.stringify(file, null, 2)}\n`, { mode: 0o600 });
  chmodSync(credentialsPath, 0o600);
}

function writeCredential(provider, key, value, fields = {}) {
  const trimmed = String(value || '').trim();
  if (!trimmed) return false;
  const file = readCredentialFile();
  const now = new Date().toISOString();
  const existing = file.credentials.find((entry) => (
    entry.provider === provider &&
    entry.key === key &&
    (entry.workspaceId || '') === (fields.workspaceId || '') &&
    (entry.externalWorkspaceId || '') === (fields.externalWorkspaceId || '') &&
    (entry.userId || '') === (fields.userId || '')
  ));
  const next = {
    provider,
    key,
    value: trimmed,
    workspaceId: fields.workspaceId,
    externalWorkspaceId: fields.externalWorkspaceId,
    userId: fields.userId,
    metadata: fields.metadata,
    createdAt: existing?.createdAt || now,
    updatedAt: now
  };
  if (existing) Object.assign(existing, next);
  else file.credentials.push(next);
  writeCredentialFile(file);
  return true;
}

function mask(value) {
  const text = String(value || '');
  return text.length <= 4 ? '****' : `****${text.slice(-4)}`;
}

function readEnvFile() {
  return existsSync(envPath) ? readFileSync(envPath, 'utf8') : '';
}

function envValues() {
  const values = {};
  for (const line of readEnvFile().split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Z0-9_]+)=(.*)$/);
    if (!match) continue;
    values[match[1]] = match[2].trim().replace(/^['"]|['"]$/g, '');
  }
  return values;
}

function sqlitePath() {
  const env = envValues();
  if (process.env.MURPH_SQLITE_PATH || env.MURPH_SQLITE_PATH) {
    return path.resolve(appDir, process.env.MURPH_SQLITE_PATH || env.MURPH_SQLITE_PATH);
  }
  if (existsSync(configPath)) {
    const config = parse(readFileSync(configPath, 'utf8')) || {};
    if (config?.app?.sqlitePath) {
      return path.resolve(appDir, config.app.sqlitePath);
    }
  }
  return path.resolve(appDir, 'data/murph.sqlite');
}

function decryptString(payload, secret) {
  const [ivBase64, tagBase64, contentBase64] = String(payload || '').split('.');
  if (!ivBase64 || !tagBase64 || !contentBase64) {
    throw new Error('Invalid encrypted payload');
  }
  const key = createHash('sha256').update(secret).digest();
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivBase64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagBase64, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(contentBase64, 'base64')),
    decipher.final()
  ]).toString('utf8');
}

function maybeDecrypt(value, encryptionKey) {
  if (!value || value === 'stored-in-local-credentials') return undefined;
  if (String(value).split('.').length === 3 && encryptionKey) {
    return decryptString(value, encryptionKey);
  }
  if (String(value).split('.').length !== 3) {
    return value;
  }
  return undefined;
}

function migrateEnv() {
  let count = 0;
  const values = envValues();
  for (const [envKey, [provider, key]] of Object.entries(SECRET_KEY_MAP)) {
    if (values[envKey] && writeCredential(provider, key, values[envKey])) {
      count += 1;
    }
  }
  return count;
}

function migrateSqlite() {
  const dbPath = sqlitePath();
  if (!existsSync(dbPath)) return { count: 0, skipped: 0 };
  const values = envValues();
  const encryptionKey = process.env.MURPH_ENCRYPTION_KEY || values.MURPH_ENCRYPTION_KEY || '';
  const db = new Database(dbPath, { readonly: true });
  let count = 0;
  let skipped = 0;

  try {
    const workspaces = db.prepare(`SELECT id, provider, external_workspace_id, name, bot_token_encrypted, bot_user_id FROM workspaces`).all();
    for (const workspace of workspaces) {
      const value = maybeDecrypt(workspace.bot_token_encrypted, encryptionKey);
      if (!value) {
        skipped += 1;
        continue;
      }
      const provider = workspace.provider || 'slack';
      if (writeCredential(provider, 'bot_token', value, {
        workspaceId: workspace.id,
        externalWorkspaceId: workspace.external_workspace_id,
        metadata: { workspaceName: workspace.name, botUserId: workspace.bot_user_id }
      })) count += 1;
    }
  } catch {}

  try {
    const credentials = db.prepare(`SELECT workspace_id, provider, credential_kind, credential_encrypted, metadata_json FROM integration_credentials WHERE status = 'connected'`).all();
    for (const credential of credentials) {
      const value = maybeDecrypt(credential.credential_encrypted, encryptionKey);
      if (!value) {
        skipped += 1;
        continue;
      }
      let metadata = {};
      try {
        metadata = credential.metadata_json ? JSON.parse(credential.metadata_json) : {};
      } catch {}
      if (writeCredential(credential.provider, credential.credential_kind, value, {
        workspaceId: credential.workspace_id,
        metadata
      })) count += 1;
    }
  } catch {}

  db.close();
  return { count, skipped };
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
  const values = envValues();
  const legacyEnvKeys = Object.keys(SECRET_KEY_MAP).filter((key) => values[key]);
  console.log(`Credentials file: ${credentialsPath}`);
  console.log(`Stored credentials: ${file.credentials.length}`);
  console.log(`Legacy .env secrets: ${legacyEnvKeys.length ? legacyEnvKeys.join(', ') : 'none'}`);
  console.log(`SQLite path: ${sqlitePath()}`);
}

function cleanupLegacy() {
  const raw = readEnvFile();
  let envRemoved = 0;
  const secretKeys = new Set(Object.keys(SECRET_KEY_MAP));
  if (raw) {
    const lines = raw.split(/\r?\n/).filter((line) => {
      const match = line.match(/^\s*(?:export\s+)?([A-Z0-9_]+)=/);
      if (match && secretKeys.has(match[1])) {
        envRemoved += 1;
        return false;
      }
      return true;
    });
    writeFileSync(envPath, `${lines.join('\n').replace(/\n+$/, '')}\n`, { mode: 0o600 });
    chmodSync(envPath, 0o600);
  }

  let sqliteCleared = 0;
  const dbPath = sqlitePath();
  if (existsSync(dbPath)) {
    const db = new Database(dbPath);
    try {
      sqliteCleared += db
        .prepare(`UPDATE workspaces SET bot_token_encrypted = 'stored-in-local-credentials' WHERE bot_token_encrypted IS NOT NULL AND bot_token_encrypted != 'stored-in-local-credentials'`)
        .run().changes;
    } catch {}
    try {
      sqliteCleared += db
        .prepare(`UPDATE integration_credentials SET credential_encrypted = 'stored-in-local-credentials' WHERE credential_encrypted != 'stored-in-local-credentials'`)
        .run().changes;
    } catch {}
    db.close();
  }

  console.log(`Removed ${envRemoved} .env secret(s) and cleared ${sqliteCleared} legacy SQLite secret field(s).`);
}

const command = process.argv[2] || 'help';
if (command === 'list') {
  list();
} else if (command === 'doctor') {
  doctor();
} else if (command === 'migrate') {
  const envCount = migrateEnv();
  const sqlite = migrateSqlite();
  console.log(`Migrated ${envCount + sqlite.count} credential(s) to ${credentialsPath}.`);
  if (sqlite.skipped > 0) {
    console.log(`Skipped ${sqlite.skipped} legacy SQLite credential(s) that require reconnecting or MURPH_ENCRYPTION_KEY.`);
  }
} else if (command === 'cleanup-legacy') {
  cleanupLegacy();
} else {
  usage();
  if (command !== 'help' && command !== '-h' && command !== '--help') process.exitCode = 1;
}
