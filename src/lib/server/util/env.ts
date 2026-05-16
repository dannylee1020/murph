import { DEFAULT_AGENT_MODEL, DEFAULT_HEARTBEAT_INTERVAL_MS, DEFAULT_SQLITE_PATH } from '#lib/config';
import type { ProviderName } from '#lib/types';
import { readMurphConfig } from '#lib/server/setup/config-file';
import { loadDotEnv } from './dotenv.js';

loadDotEnv();

export interface RuntimeEnv {
  appUrl: string;
  sqlitePath: string;
  encryptionKey: string;
  slackClientId?: string;
  slackClientSecret?: string;
  slackSigningSecret?: string;
  slackAppToken?: string;
  slackEventsMode: 'socket' | 'http';
  discordBotToken?: string;
  discordClientId?: string;
  discordClientSecret?: string;
  discordRedirectUri?: string;
  heartbeatIntervalMs: number;
  openaiApiKey?: string;
  anthropicApiKey?: string;
  defaultProvider: ProviderName;
  agentProvider: ProviderName;
  agentModel: string;
  notionApiKey?: string;
  notionVersion: string;
  notionMaxResults: number;
  githubPat?: string;
  githubRepositories: string[];
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

function envOrConfigString(envKey: string, configValue: string | undefined, fallback = ''): string {
  return process.env[envKey] ?? configValue ?? fallback;
}

function envOrConfigNumber(envKey: string, configValue: number | undefined, fallback: number): number {
  const raw = process.env[envKey];
  if (raw !== undefined) return Number(raw);
  return configValue ?? fallback;
}

function envOrConfigCsv(envKey: string, configValue: string[] | undefined): string[] {
  if (process.env[envKey] !== undefined) return csvEnv(process.env[envKey]);
  return configValue ?? [];
}

export function getRuntimeEnv(): RuntimeEnv {
  if (cachedEnv) {
    return cachedEnv;
  }

  const config = readMurphConfig();
  const defaultProvider: ProviderName = process.env.MURPH_DEFAULT_PROVIDER === 'anthropic'
    ? 'anthropic'
    : process.env.MURPH_DEFAULT_PROVIDER === 'openai'
      ? 'openai'
      : config.ai?.defaultProvider ?? 'openai';
  const agentProvider: ProviderName = process.env.MURPH_AGENT_PROVIDER === 'anthropic'
    ? 'anthropic'
    : process.env.MURPH_AGENT_PROVIDER === 'openai'
      ? 'openai'
      : config.ai?.agent?.provider
        ? config.ai.agent.provider
      : process.env.OPENAI_API_KEY
        ? 'openai'
        : process.env.ANTHROPIC_API_KEY
          ? 'anthropic'
          : defaultProvider;

  cachedEnv = {
    appUrl: envOrConfigString('MURPH_APP_URL', config.app?.url, 'http://localhost:5173'),
    sqlitePath: envOrConfigString('MURPH_SQLITE_PATH', config.app?.sqlitePath, DEFAULT_SQLITE_PATH),
    encryptionKey: process.env.MURPH_ENCRYPTION_KEY ?? '',
    slackClientId: process.env.SLACK_CLIENT_ID ?? config.channels?.slack?.clientId,
    slackClientSecret: process.env.SLACK_CLIENT_SECRET,
    slackSigningSecret: process.env.SLACK_SIGNING_SECRET,
    slackAppToken: process.env.SLACK_APP_TOKEN,
    slackEventsMode: process.env.SLACK_EVENTS_MODE === 'http'
      ? 'http'
      : process.env.SLACK_EVENTS_MODE === 'socket'
        ? 'socket'
        : config.channels?.slack?.eventsMode ?? 'socket',
    discordBotToken: process.env.DISCORD_BOT_TOKEN,
    discordClientId: process.env.DISCORD_CLIENT_ID ?? config.channels?.discord?.clientId,
    discordClientSecret: process.env.DISCORD_CLIENT_SECRET,
    discordRedirectUri: process.env.DISCORD_REDIRECT_URI ?? config.channels?.discord?.redirectUri,
    heartbeatIntervalMs: envOrConfigNumber('MURPH_HEARTBEAT_INTERVAL_MS', config.app?.heartbeatIntervalMs, DEFAULT_HEARTBEAT_INTERVAL_MS),
    openaiApiKey: process.env.OPENAI_API_KEY,
    anthropicApiKey: process.env.ANTHROPIC_API_KEY,
    defaultProvider,
    agentProvider,
    agentModel: process.env.MURPH_AGENT_MODEL || config.ai?.agent?.model || DEFAULT_AGENT_MODEL[agentProvider],
    notionApiKey: process.env.NOTION_API_KEY,
    notionVersion: envOrConfigString('NOTION_VERSION', config.integrations?.notion?.version, '2026-03-11'),
    notionMaxResults: envOrConfigNumber('NOTION_MAX_RESULTS', config.integrations?.notion?.maxResults, 3),
    githubPat: process.env.GITHUB_PAT,
    githubRepositories: envOrConfigCsv('GITHUB_REPOSITORIES', config.integrations?.github?.repositories),
    obsidianVaultPath: process.env.OBSIDIAN_VAULT_PATH ?? config.integrations?.obsidian?.vaultPath,
    granolaApiKey: process.env.GRANOLA_API_KEY,
    googleAccessToken: process.env.GOOGLE_ACCESS_TOKEN,
    googleClientId: process.env.GOOGLE_CLIENT_ID,
    googleClientSecret: process.env.GOOGLE_CLIENT_SECRET,
    googleCalendarId: envOrConfigString('GOOGLE_CALENDAR_ID', config.integrations?.google?.calendarId, 'primary'),
    webSearchBackend: process.env.MURPH_WEB_SEARCH_BACKEND === 'brave'
      ? 'brave'
      : process.env.MURPH_WEB_SEARCH_BACKEND === 'tavily'
        ? 'tavily'
        : config.integrations?.webSearch?.backend ?? 'brave',
    tavilyApiKey: process.env.TAVILY_API_KEY,
    braveSearchApiKey: process.env.BRAVE_SEARCH_API_KEY,
    fileReadAllowedRoots: envOrConfigCsv('MURPH_FILE_READ_ALLOWED_ROOTS', config.integrations?.localTools?.fileReadAllowedRoots),
    shellAllowedCommandsJson: envOrConfigString('MURPH_SHELL_ALLOWED_COMMANDS_JSON', config.integrations?.localTools?.shellAllowedCommandsJson),
    contextSourceTimeoutMs: envOrConfigNumber('MURPH_CONTEXT_SOURCE_TIMEOUT_MS', config.app?.contextSourceTimeoutMs, 3000),
    contextSourceMaxOptional: envOrConfigNumber('MURPH_CONTEXT_SOURCE_MAX_OPTIONAL', config.app?.contextSourceMaxOptional, 3),
    runEventRetentionDays: envOrConfigNumber('MURPH_RUN_EVENT_RETENTION_DAYS', config.app?.runEventRetentionDays, 30)
  };

  return cachedEnv;
}

export function resetRuntimeEnvCache(): void {
  cachedEnv = null;
}
