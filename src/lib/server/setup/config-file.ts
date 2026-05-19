import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { parse, stringify } from 'yaml';
import type { ProviderName, SetupDefaults } from '#lib/types';

export const MURPH_CONFIG_FILE = 'config.yaml';

export interface MurphConfig {
  app?: {
    url?: string;
    sqlitePath?: string;
    heartbeatIntervalMs?: number;
    runEventRetentionDays?: number;
    contextSourceTimeoutMs?: number;
    contextSourceMaxOptional?: number;
  };
  ai?: {
    defaultProvider?: ProviderName;
    defaultModel?: string;
    agent?: {
      provider?: ProviderName;
      model?: string;
    };
  };
  channels?: {
    slack?: {
      eventsMode?: 'socket' | 'http';
      clientId?: string;
      appId?: string;
      teamId?: string;
      teamName?: string;
    };
    discord?: {
      clientId?: string;
      redirectUri?: string;
    };
  };
  setup?: SetupDefaults;
  integrations?: {
    notion?: {
      version?: string;
      maxResults?: number;
    };
    github?: {
      repositories?: string[];
    };
    google?: {
      calendarId?: string;
    };
    obsidian?: {
      vaultPath?: string;
    };
    webSearch?: {
      backend?: 'tavily' | 'brave';
    };
    localTools?: {
      fileReadAllowedRoots?: string[];
      shellAllowedCommandsJson?: string;
    };
  };
  policy?: {
    profile?: string;
  };
}

const CONFIG_KEY_SETTERS: Record<string, (config: Record<string, unknown>, value: string) => void> = {
  MURPH_APP_URL: (config, value) => setPath(config, ['app', 'url'], value),
  MURPH_SQLITE_PATH: (config, value) => setPath(config, ['app', 'sqlitePath'], value),
  MURPH_HEARTBEAT_INTERVAL_MS: (config, value) => setPath(config, ['app', 'heartbeatIntervalMs'], numberFromString(value)),
  MURPH_RUN_EVENT_RETENTION_DAYS: (config, value) => setPath(config, ['app', 'runEventRetentionDays'], numberFromString(value)),
  MURPH_CONTEXT_SOURCE_TIMEOUT_MS: (config, value) => setPath(config, ['app', 'contextSourceTimeoutMs'], numberFromString(value)),
  MURPH_CONTEXT_SOURCE_MAX_OPTIONAL: (config, value) => setPath(config, ['app', 'contextSourceMaxOptional'], numberFromString(value)),
  MURPH_DEFAULT_PROVIDER: (config, value) => setPath(config, ['ai', 'defaultProvider'], providerFromString(value)),
  MURPH_DEFAULT_MODEL: (config, value) => setPath(config, ['ai', 'defaultModel'], value),
  MURPH_AGENT_PROVIDER: (config, value) => setPath(config, ['ai', 'agent', 'provider'], providerFromString(value)),
  MURPH_AGENT_MODEL: (config, value) => setPath(config, ['ai', 'agent', 'model'], value),
  SLACK_EVENTS_MODE: (config, value) => setPath(config, ['channels', 'slack', 'eventsMode'], value === 'http' ? 'http' : 'socket'),
  SLACK_CLIENT_ID: (config, value) => setPath(config, ['channels', 'slack', 'clientId'], value),
  SLACK_APP_ID: (config, value) => setPath(config, ['channels', 'slack', 'appId'], value),
  SLACK_TEAM_ID: (config, value) => setPath(config, ['channels', 'slack', 'teamId'], value),
  SLACK_TEAM_NAME: (config, value) => setPath(config, ['channels', 'slack', 'teamName'], value),
  DISCORD_CLIENT_ID: (config, value) => setPath(config, ['channels', 'discord', 'clientId'], value),
  DISCORD_REDIRECT_URI: (config, value) => setPath(config, ['channels', 'discord', 'redirectUri'], value),
  NOTION_VERSION: (config, value) => setPath(config, ['integrations', 'notion', 'version'], value),
  NOTION_MAX_RESULTS: (config, value) => setPath(config, ['integrations', 'notion', 'maxResults'], numberFromString(value)),
  GITHUB_REPOSITORIES: (config, value) => setPath(config, ['integrations', 'github', 'repositories'], csvFromString(value)),
  GOOGLE_CALENDAR_ID: (config, value) => setPath(config, ['integrations', 'google', 'calendarId'], value),
  OBSIDIAN_VAULT_PATH: (config, value) => setPath(config, ['integrations', 'obsidian', 'vaultPath'], value),
  MURPH_WEB_SEARCH_BACKEND: (config, value) => setPath(config, ['integrations', 'webSearch', 'backend'], value === 'brave' ? 'brave' : 'tavily'),
  MURPH_FILE_READ_ALLOWED_ROOTS: (config, value) => setPath(config, ['integrations', 'localTools', 'fileReadAllowedRoots'], csvFromString(value)),
  MURPH_SHELL_ALLOWED_COMMANDS_JSON: (config, value) => setPath(config, ['integrations', 'localTools', 'shellAllowedCommandsJson'], value)
};

export const SETUP_CONFIG_KEYS = new Set(Object.keys(CONFIG_KEY_SETTERS));

const CONFIG_KEY_CLEARERS: Record<string, (config: Record<string, unknown>) => void> = {
  MURPH_AGENT_PROVIDER: (config) => deletePath(config, ['ai', 'agent', 'provider']),
  MURPH_AGENT_MODEL: (config) => deletePath(config, ['ai', 'agent', 'model'])
};

function murphHome(): string {
  return process.env.MURPH_HOME || path.join(homedir(), '.murph');
}

export function murphConfigPath(): string {
  return process.env.MURPH_CONFIG_PATH || path.join(murphHome(), MURPH_CONFIG_FILE);
}

function configPath(_cwd = process.cwd()): string {
  return path.resolve(murphConfigPath());
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function objectAt(target: Record<string, unknown>, key: string): Record<string, unknown> {
  const current = target[key];
  if (isRecord(current)) return current;
  const next: Record<string, unknown> = {};
  target[key] = next;
  return next;
}

function setPath(target: Record<string, unknown>, parts: string[], value: unknown): void {
  let cursor = target;
  for (const part of parts.slice(0, -1)) {
    cursor = objectAt(cursor, part);
  }
  cursor[parts[parts.length - 1]] = value;
}

function deletePath(target: Record<string, unknown>, parts: string[]): void {
  let cursor: Record<string, unknown> | undefined = target;
  for (const part of parts.slice(0, -1)) {
    if (!cursor) return;
    const next: unknown = cursor[part];
    if (!isRecord(next)) return;
    cursor = next;
  }
  delete cursor[parts[parts.length - 1]];
}

function readRawConfig(cwd = process.cwd()): Record<string, unknown> {
  const target = configPath(cwd);
  if (!existsSync(target)) return {};
  const parsed = parse(readFileSync(target, 'utf8')) ?? {};
  if (!isRecord(parsed)) {
    throw new Error(`${MURPH_CONFIG_FILE} must contain a YAML object.`);
  }
  return parsed;
}

function writeRawConfig(config: Record<string, unknown>, cwd = process.cwd()): void {
  const target = configPath(cwd);
  mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
  writeFileSync(target, stringify(config, { lineWidth: 100 }), { mode: 0o600 });
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function providerValue(value: unknown): ProviderName | undefined {
  return value === 'anthropic' ? 'anthropic' : value === 'openai' ? 'openai' : undefined;
}

function stringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const values = value.map((entry) => stringValue(entry)).filter((entry): entry is string => Boolean(entry));
  return values.length > 0 ? values : [];
}

function setupDefaultsValue(value: unknown): SetupDefaults | undefined {
  if (!isRecord(value)) return undefined;
  const selectedChannelsRaw = value.selectedChannels;
  const selectedChannels = Array.isArray(selectedChannelsRaw)
    ? selectedChannelsRaw
        .filter(isRecord)
        .map((channel) => ({
          id: stringValue(channel.id) ?? '',
          displayName: stringValue(channel.displayName) ?? stringValue(channel.id) ?? ''
        }))
        .filter((channel) => channel.id && channel.displayName)
    : undefined;
  return {
    channelProvider: stringValue(value.channelProvider),
    workspaceId: stringValue(value.workspaceId),
    ownerUserId: stringValue(value.ownerUserId),
    ownerDisplayName: stringValue(value.ownerDisplayName),
    channelScopeMode: value.channelScopeMode === 'all_accessible' ? 'all_accessible' : value.channelScopeMode === 'selected' ? 'selected' : undefined,
    selectedChannels,
    timezone: stringValue(value.timezone),
    workdayStartHour: numberValue(value.workdayStartHour),
    workdayEndHour: numberValue(value.workdayEndHour)
  };
}

function numberFromString(value: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Expected numeric config value, received: ${value}`);
  }
  return parsed;
}

function providerFromString(value: string): ProviderName {
  if (value === 'openai' || value === 'anthropic') return value;
  throw new Error(`Expected provider to be openai or anthropic, received: ${value}`);
}

function csvFromString(value: string): string[] {
  return value.split(',').map((entry) => entry.trim()).filter(Boolean);
}

export function murphConfigExists(cwd = process.cwd()): boolean {
  return existsSync(configPath(cwd));
}

export function readMurphConfig(cwd = process.cwd()): MurphConfig {
  const raw = readRawConfig(cwd);
  const app = isRecord(raw.app) ? raw.app : {};
  const ai = isRecord(raw.ai) ? raw.ai : {};
  const agent = isRecord(ai.agent) ? ai.agent : {};
  const channels = isRecord(raw.channels) ? raw.channels : {};
  const slack = isRecord(channels.slack) ? channels.slack : {};
  const discord = isRecord(channels.discord) ? channels.discord : {};
  const integrations = isRecord(raw.integrations) ? raw.integrations : {};
  const notion = isRecord(integrations.notion) ? integrations.notion : {};
  const github = isRecord(integrations.github) ? integrations.github : {};
  const google = isRecord(integrations.google) ? integrations.google : {};
  const obsidian = isRecord(integrations.obsidian) ? integrations.obsidian : {};
  const webSearch = isRecord(integrations.webSearch) ? integrations.webSearch : {};
  const localTools = isRecord(integrations.localTools) ? integrations.localTools : {};
  const policy = isRecord(raw.policy) ? raw.policy : {};

  return {
    app: {
      url: stringValue(app.url),
      sqlitePath: stringValue(app.sqlitePath),
      heartbeatIntervalMs: numberValue(app.heartbeatIntervalMs),
      runEventRetentionDays: numberValue(app.runEventRetentionDays),
      contextSourceTimeoutMs: numberValue(app.contextSourceTimeoutMs),
      contextSourceMaxOptional: numberValue(app.contextSourceMaxOptional)
    },
    ai: {
      defaultProvider: providerValue(ai.defaultProvider),
      defaultModel: stringValue(ai.defaultModel),
      agent: {
        provider: providerValue(agent.provider),
        model: stringValue(agent.model)
      }
    },
    channels: {
      slack: {
        eventsMode: slack.eventsMode === 'http' ? 'http' : slack.eventsMode === 'socket' ? 'socket' : undefined,
        clientId: stringValue(slack.clientId),
        appId: stringValue(slack.appId),
        teamId: stringValue(slack.teamId),
        teamName: stringValue(slack.teamName)
      },
      discord: {
        clientId: stringValue(discord.clientId),
        redirectUri: stringValue(discord.redirectUri)
      }
    },
    setup: setupDefaultsValue(raw.setup),
    integrations: {
      notion: {
        version: stringValue(notion.version),
        maxResults: numberValue(notion.maxResults)
      },
      github: {
        repositories: stringArray(github.repositories)
      },
      google: {
        calendarId: stringValue(google.calendarId)
      },
      obsidian: {
        vaultPath: stringValue(obsidian.vaultPath)
      },
      webSearch: {
        backend: webSearch.backend === 'brave' ? 'brave' : webSearch.backend === 'tavily' ? 'tavily' : undefined
      },
      localTools: {
        fileReadAllowedRoots: stringArray(localTools.fileReadAllowedRoots),
        shellAllowedCommandsJson: stringValue(localTools.shellAllowedCommandsJson)
      }
    },
    policy: {
      profile: stringValue(policy.profile)
    }
  };
}

export function updateMurphConfigValues(values: Record<string, string | undefined>, cwd = process.cwd()): { updated: string[] } {
  const raw = readRawConfig(cwd);
  const updated: string[] = [];
  for (const [key, rawValue] of Object.entries(values)) {
    const setter = CONFIG_KEY_SETTERS[key];
    if (!setter) {
      throw new Error(`Unsupported config key: ${key}`);
    }
    const value = rawValue?.trim();
    if (!value) {
      const clearer = CONFIG_KEY_CLEARERS[key];
      if (!clearer) continue;
      clearer(raw);
      updated.push(key);
      continue;
    }
    setter(raw, value);
    updated.push(key);
  }
  if (updated.length > 0) {
    writeRawConfig(raw, cwd);
  }
  return { updated };
}

export function updateMurphSetupDefaults(defaults: SetupDefaults, cwd = process.cwd()): void {
  const raw = readRawConfig(cwd);
  setPath(raw, ['setup'], defaults);
  writeRawConfig(raw, cwd);
}

export function updateMurphPolicyProfile(profileName: string | undefined, cwd = process.cwd()): void {
  const raw = readRawConfig(cwd);
  setPath(raw, ['policy', 'profile'], profileName);
  writeRawConfig(raw, cwd);
}
