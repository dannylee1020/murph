import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { SETUP_CONFIG_KEYS, updateMurphConfigValues } from '#lib/server/setup/config-file';
import { resetRuntimeEnvCache } from '#lib/server/util/env';

const SETUP_SECRET_KEYS = new Set([
  'MURPH_ENCRYPTION_KEY',
  'OPENAI_API_KEY',
  'ANTHROPIC_API_KEY',
  'SLACK_APP_TOKEN',
  'SLACK_CLIENT_SECRET',
  'SLACK_SIGNING_SECRET',
  'DISCORD_BOT_TOKEN',
  'DISCORD_CLIENT_SECRET',
  'GOOGLE_ACCESS_TOKEN',
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'GITHUB_PAT',
  'NOTION_API_KEY',
  'GRANOLA_API_KEY',
  'TAVILY_API_KEY',
  'BRAVE_SEARCH_API_KEY'
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
  const secretValues: Record<string, string | undefined> = {};
  const configValues: Record<string, string | undefined> = {};

  for (const [key, value] of Object.entries(values)) {
    if (SETUP_SECRET_KEYS.has(key)) {
      secretValues[key] = value;
    } else if (SETUP_CONFIG_KEYS.has(key)) {
      configValues[key] = value;
    } else {
      throw new Error(`Unsupported setup key: ${key}`);
    }
  }

  const target = envPath();
  const existing = existsSync(target) ? readFileSync(target, 'utf8') : '';
  const lines = existing ? existing.split(/\r?\n/) : [];
  const updated: string[] = [];

  for (const [key, rawValue] of Object.entries(secretValues)) {
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
  }

  const configUpdated = updateMurphConfigValues(configValues).updated;
  for (const key of configUpdated) {
    const value = configValues[key]?.trim();
    if (value) process.env[key] = value;
  }

  resetRuntimeEnvCache();
  updated.push(...configUpdated);

  return { updated };
}
