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
  discordBotToken?: string;
  discordClientId?: string;
  discordClientSecret?: string;
  discordRedirectUri?: string;
  heartbeatIntervalMs: number;
  openaiApiKey?: string;
  anthropicApiKey?: string;
  defaultProvider: ProviderName;
  notionApiKey?: string;
  notionVersion: string;
  notionAllowedPageIds: string[];
  notionAllowedDataSourceIds: string[];
  notionMaxResults: number;
  githubPat?: string;
  obsidianVaultPath?: string;
  granolaApiKey?: string;
  googleAccessToken?: string;
  googleClientId?: string;
  googleClientSecret?: string;
  googleCalendarId: string;
  webSearchBackend: 'tavily' | 'brave';
  tavilyApiKey?: string;
  braveSearchApiKey?: string;
  fileReadAllowedRoots: string[];
  shellAllowedCommandsJson: string;
  contextSourceTimeoutMs: number;
  contextSourceMaxOptional: number;
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
    appUrl: process.env.MURPH_APP_URL ?? 'http://localhost:5173',
    sqlitePath: process.env.MURPH_SQLITE_PATH ?? DEFAULT_SQLITE_PATH,
    encryptionKey: process.env.MURPH_ENCRYPTION_KEY ?? '',
    slackClientId: process.env.SLACK_CLIENT_ID,
    slackClientSecret: process.env.SLACK_CLIENT_SECRET,
    slackSigningSecret: process.env.SLACK_SIGNING_SECRET,
    discordBotToken: process.env.DISCORD_BOT_TOKEN,
    discordClientId: process.env.DISCORD_CLIENT_ID,
    discordClientSecret: process.env.DISCORD_CLIENT_SECRET,
    discordRedirectUri: process.env.DISCORD_REDIRECT_URI,
    heartbeatIntervalMs: Number(process.env.MURPH_HEARTBEAT_INTERVAL_MS ?? DEFAULT_HEARTBEAT_INTERVAL_MS),
    openaiApiKey: process.env.OPENAI_API_KEY,
    anthropicApiKey: process.env.ANTHROPIC_API_KEY,
    defaultProvider: process.env.MURPH_DEFAULT_PROVIDER === 'anthropic' ? 'anthropic' : 'openai',
    notionApiKey: process.env.NOTION_API_KEY,
    notionVersion: process.env.NOTION_VERSION ?? '2026-03-11',
    notionAllowedPageIds: csvEnv(process.env.NOTION_ALLOWED_PAGE_IDS),
    notionAllowedDataSourceIds: csvEnv(process.env.NOTION_ALLOWED_DATA_SOURCE_IDS),
    notionMaxResults: Number(process.env.NOTION_MAX_RESULTS ?? 3),
    githubPat: process.env.GITHUB_PAT,
    obsidianVaultPath: process.env.OBSIDIAN_VAULT_PATH,
    granolaApiKey: process.env.GRANOLA_API_KEY,
    googleAccessToken: process.env.GOOGLE_ACCESS_TOKEN,
    googleClientId: process.env.GOOGLE_CLIENT_ID,
    googleClientSecret: process.env.GOOGLE_CLIENT_SECRET,
    googleCalendarId: process.env.GOOGLE_CALENDAR_ID ?? 'primary',
    webSearchBackend: process.env.MURPH_WEB_SEARCH_BACKEND === 'brave' ? 'brave' : 'tavily',
    tavilyApiKey: process.env.TAVILY_API_KEY,
    braveSearchApiKey: process.env.BRAVE_SEARCH_API_KEY,
    fileReadAllowedRoots: csvEnv(process.env.MURPH_FILE_READ_ALLOWED_ROOTS),
    shellAllowedCommandsJson: process.env.MURPH_SHELL_ALLOWED_COMMANDS_JSON ?? '',
    contextSourceTimeoutMs: Number(process.env.MURPH_CONTEXT_SOURCE_TIMEOUT_MS ?? 3000),
    contextSourceMaxOptional: Number(process.env.MURPH_CONTEXT_SOURCE_MAX_OPTIONAL ?? 3),
    runEventRetentionDays: Number(process.env.MURPH_RUN_EVENT_RETENTION_DAYS ?? 30)
  };

  return cachedEnv;
}
