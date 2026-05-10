import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { resetRuntimeEnvCache } from '#lib/server/util/env';

const SETUP_ENV_KEYS = new Set([
  'MURPH_APP_URL',
  'MURPH_SQLITE_PATH',
  'MURPH_ENCRYPTION_KEY',
  'MURPH_DEFAULT_PROVIDER',
  'OPENAI_API_KEY',
  'ANTHROPIC_API_KEY',
  'SLACK_EVENTS_MODE',
  'SLACK_APP_TOKEN',
  'SLACK_CLIENT_ID',
  'SLACK_CLIENT_SECRET',
  'SLACK_SIGNING_SECRET'
]);

function envPath(): string {
  return path.resolve(process.cwd(), '.env');
}

function serializeValue(value: string): string {
  if (/[\s#"'\\]/.test(value)) {
    return JSON.stringify(value);
  }
  return value;
}

export function updateSetupEnv(values: Record<string, string | undefined>): { updated: string[] } {
  const target = envPath();
  const existing = existsSync(target) ? readFileSync(target, 'utf8') : '';
  const lines = existing ? existing.split(/\r?\n/) : [];
  const updated: string[] = [];

  for (const [key, rawValue] of Object.entries(values)) {
    if (!SETUP_ENV_KEYS.has(key)) {
      throw new Error(`Unsupported setup key: ${key}`);
    }
    const value = rawValue?.trim();
    if (!value) {
      continue;
    }

    const nextLine = `${key}=${serializeValue(value)}`;
    const index = lines.findIndex((line) => new RegExp(`^\\s*(?:export\\s+)?${key}=`).test(line));
    if (index >= 0) {
      lines[index] = nextLine;
    } else {
      if (lines.length > 0 && lines[lines.length - 1] !== '') {
        lines.push('');
      }
      lines.push(nextLine);
    }
    process.env[key] = value;
    updated.push(key);
  }

  if (updated.length > 0) {
    writeFileSync(target, `${lines.join('\n').replace(/\n+$/, '')}\n`, { mode: 0o600 });
    resetRuntimeEnvCache();
  }

  return { updated };
}
