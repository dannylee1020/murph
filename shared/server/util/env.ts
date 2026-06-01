import { DEFAULT_PROVIDER_MODEL, DEFAULT_HEARTBEAT_INTERVAL_MS, DEFAULT_SQLITE_PATH } from '#shared/config';
import { homedir } from 'node:os';
import path from 'node:path';
import type { ProductMode, ProviderName, RuntimeDistribution } from '#shared/types';
import { readMurphConfig } from '#shared/server/setup/config-file';
import { readSecret } from '#shared/server/credentials/local-store';

export interface RuntimeEnv {
  distribution: RuntimeDistribution;
  productMode: ProductMode;
  appUrl: string;
  sqlitePath: string;
  memoryPath: string;
  encryptionKey: string;
  slackClientId?: string;
  slackClientSecret?: string;
  slackSigningSecret?: string;
  slackAppToken?: string;
  slackEventsMode: 'socket' | 'http';
  discordBotToken?: string;
  discordClientId?: string;
  discordClientSecret?: string;
  discordPublicKey?: string;
  discordRedirectUri?: string;
  heartbeatIntervalMs: number;
  openaiApiKey?: string;
  anthropicApiKey?: string;
  defaultProvider: ProviderName;
  defaultModel: string;
  agentProvider: ProviderName;
  agentModel: string;
  policyProvider: ProviderName;
  policyModel: string;
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

function envOrSecret(envKey: string, provider: string, key: string): string | undefined {
  return readSecret(provider, key) ?? process.env[envKey];
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
  const distribution = config.app?.distribution ?? 'team';
  const defaultProvider: ProviderName = process.env.MURPH_DEFAULT_PROVIDER === 'anthropic'
    ? 'anthropic'
    : process.env.MURPH_DEFAULT_PROVIDER === 'openai'
      ? 'openai'
      : config.ai?.defaultProvider ?? 'openai';
  const defaultModel = envOrConfigString('MURPH_DEFAULT_MODEL', config.ai?.defaultModel, DEFAULT_PROVIDER_MODEL[defaultProvider]);
  const agentProvider: ProviderName = process.env.MURPH_AGENT_PROVIDER === 'anthropic'
    ? 'anthropic'
    : process.env.MURPH_AGENT_PROVIDER === 'openai'
      ? 'openai'
      : config.ai?.agent?.provider
        ? config.ai.agent.provider
      : envOrSecret('OPENAI_API_KEY', 'openai', 'api_key')
        ? 'openai'
        : envOrSecret('ANTHROPIC_API_KEY', 'anthropic', 'api_key')
          ? 'anthropic'
          : defaultProvider;
  const policyProvider: ProviderName = process.env.MURPH_POLICY_PROVIDER === 'anthropic'
    ? 'anthropic'
    : process.env.MURPH_POLICY_PROVIDER === 'openai'
      ? 'openai'
      : config.ai?.policy?.provider ?? defaultProvider;

  cachedEnv = {
    distribution,
    productMode: config.app?.productMode ?? (distribution === 'personal' ? 'personal' : 'channel'),
    appUrl: envOrConfigString('MURPH_APP_URL', config.app?.url, 'http://localhost:5173'),
    sqlitePath: envOrConfigString('MURPH_SQLITE_PATH', config.app?.sqlitePath, DEFAULT_SQLITE_PATH),
    memoryPath: envOrConfigString('MURPH_MEMORY_PATH', config.app?.memoryPath, path.join(homedir(), '.murph', 'memory')),
    encryptionKey: process.env.MURPH_ENCRYPTION_KEY ?? '',
    slackClientId: process.env.SLACK_CLIENT_ID,
    slackClientSecret: envOrSecret('SLACK_CLIENT_SECRET', 'slack', 'client_secret'),
    slackSigningSecret: envOrSecret('SLACK_SIGNING_SECRET', 'slack', 'signing_secret'),
    slackAppToken: envOrSecret('SLACK_APP_TOKEN', 'slack', 'app_token'),
    slackEventsMode: process.env.SLACK_EVENTS_MODE === 'http'
      ? 'http'
      : process.env.SLACK_EVENTS_MODE === 'socket'
        ? 'socket'
        : 'socket',
    discordBotToken: envOrSecret('DISCORD_BOT_TOKEN', 'discord', 'bot_token'),
    discordClientId: process.env.DISCORD_CLIENT_ID,
    discordClientSecret: envOrSecret('DISCORD_CLIENT_SECRET', 'discord', 'client_secret'),
    discordPublicKey: process.env.DISCORD_PUBLIC_KEY,
    discordRedirectUri: process.env.DISCORD_REDIRECT_URI,
    heartbeatIntervalMs: envOrConfigNumber('MURPH_HEARTBEAT_INTERVAL_MS', config.app?.heartbeatIntervalMs, DEFAULT_HEARTBEAT_INTERVAL_MS),
    openaiApiKey: envOrSecret('OPENAI_API_KEY', 'openai', 'api_key'),
    anthropicApiKey: envOrSecret('ANTHROPIC_API_KEY', 'anthropic', 'api_key'),
    defaultProvider,
    defaultModel,
    agentProvider,
    agentModel: process.env.MURPH_AGENT_MODEL ||
      config.ai?.agent?.model ||
      (agentProvider === defaultProvider ? defaultModel : DEFAULT_PROVIDER_MODEL[agentProvider]),
    policyProvider,
    policyModel: process.env.MURPH_POLICY_MODEL ||
      config.ai?.policy?.model ||
      (policyProvider === defaultProvider ? defaultModel : DEFAULT_PROVIDER_MODEL[policyProvider]),
    notionApiKey: envOrSecret('NOTION_API_KEY', 'notion', 'api_key'),
    notionVersion: envOrConfigString('NOTION_VERSION', config.integrations?.notion?.version, '2026-03-11'),
    notionMaxResults: envOrConfigNumber('NOTION_MAX_RESULTS', config.integrations?.notion?.maxResults, 3),
    githubPat: envOrSecret('GITHUB_PAT', 'github', 'api_key'),
    githubRepositories: envOrConfigCsv('GITHUB_REPOSITORIES', config.integrations?.github?.repositories),
    obsidianVaultPath: process.env.OBSIDIAN_VAULT_PATH?.trim()
      ? process.env.OBSIDIAN_VAULT_PATH
      : config.integrations?.obsidian?.vaultPath,
    granolaApiKey: envOrSecret('GRANOLA_API_KEY', 'granola', 'api_key'),
    googleAccessToken: envOrSecret('GOOGLE_ACCESS_TOKEN', 'google', 'access_token'),
    googleClientId: process.env.GOOGLE_CLIENT_ID ?? config.integrations?.google?.clientId,
    googleClientSecret: envOrSecret('GOOGLE_CLIENT_SECRET', 'google', 'client_secret'),
    googleCalendarId: envOrConfigString('GOOGLE_CALENDAR_ID', config.integrations?.google?.calendarId, 'primary'),
    webSearchBackend: process.env.MURPH_WEB_SEARCH_BACKEND === 'brave'
      ? 'brave'
      : process.env.MURPH_WEB_SEARCH_BACKEND === 'tavily'
        ? 'tavily'
        : config.integrations?.webSearch?.backend ?? 'brave',
    tavilyApiKey: envOrSecret('TAVILY_API_KEY', 'tavily', 'api_key'),
    braveSearchApiKey: envOrSecret('BRAVE_SEARCH_API_KEY', 'brave_search', 'api_key'),
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
