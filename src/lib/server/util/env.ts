import { DEFAULT_HEARTBEAT_INTERVAL_MS, DEFAULT_SQLITE_PATH } from '#lib/config';
import type { ProviderName } from '#lib/types';
import { loadDotEnv } from './dotenv.js';

loadDotEnv();

export interface RuntimeEnv {
  appUrl: string;
  sqlitePath: string;
  encryptionKey: string;
  slackClientId?: string;
  slackClientSecret?: string;
  slackSigningSecret?: string;
  heartbeatIntervalMs: number;
  openaiApiKey?: string;
  anthropicApiKey?: string;
  defaultProvider: ProviderName;
  notionApiKey?: string;
  notionVersion: string;
  notionAllowedPageIds: string[];
  notionAllowedDataSourceIds: string[];
  notionMaxResults: number;
  runEventRetentionDays: number;
}

let cachedEnv: RuntimeEnv | null = null;

function csvEnv(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function getRuntimeEnv(): RuntimeEnv {
  if (cachedEnv) {
    return cachedEnv;
  }

  cachedEnv = {
    appUrl: process.env.NIGHTCLAW_APP_URL ?? 'http://localhost:5173',
    sqlitePath: process.env.NIGHTCLAW_SQLITE_PATH ?? DEFAULT_SQLITE_PATH,
    encryptionKey: process.env.NIGHTCLAW_ENCRYPTION_KEY ?? '',
    slackClientId: process.env.SLACK_CLIENT_ID,
    slackClientSecret: process.env.SLACK_CLIENT_SECRET,
    slackSigningSecret: process.env.SLACK_SIGNING_SECRET,
    heartbeatIntervalMs: Number(process.env.NIGHTCLAW_HEARTBEAT_INTERVAL_MS ?? DEFAULT_HEARTBEAT_INTERVAL_MS),
    openaiApiKey: process.env.OPENAI_API_KEY,
    anthropicApiKey: process.env.ANTHROPIC_API_KEY,
    defaultProvider: process.env.NIGHTCLAW_DEFAULT_PROVIDER === 'anthropic' ? 'anthropic' : 'openai',
    notionApiKey: process.env.NOTION_API_KEY,
    notionVersion: process.env.NOTION_VERSION ?? '2026-03-11',
    notionAllowedPageIds: csvEnv(process.env.NOTION_ALLOWED_PAGE_IDS),
    notionAllowedDataSourceIds: csvEnv(process.env.NOTION_ALLOWED_DATA_SOURCE_IDS),
    notionMaxResults: Number(process.env.NOTION_MAX_RESULTS ?? 3),
    runEventRetentionDays: Number(process.env.NIGHTCLAW_RUN_EVENT_RETENTION_DAYS ?? 30)
  };

  return cachedEnv;
}
