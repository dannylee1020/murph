import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parse, stringify } from 'yaml';
import type { BotRole, ProductMode, ProviderName, RuntimeDistribution, SetupDefaults } from '#shared/types';
import { murphHome } from '#shared/server/setup/paths';
import { normalizeProviderBotRoleMap } from '#shared/server/setup/bot-roles';

export const MURPH_CONFIG_FILE = 'config.yaml';

export interface MurphConfig {
  app?: {
    distribution?: RuntimeDistribution;
    productMode?: ProductMode;
    url?: string;
    sqlitePath?: string;
    heartbeatIntervalMs?: number;
    runEventRetentionDays?: number;
    contextSourceTimeoutMs?: number;
    contextSourceMaxOptional?: number;
    sourceIndexEnabled?: boolean;
    sourceIndexIntervalMs?: number;
    sourceIndexRetryIntervalMs?: number;
    timezone?: string;
    workdayStartHour?: number;
    workdayEndHour?: number;
  };
  ai?: {
    defaultProvider?: ProviderName;
    defaultModel?: string;
    agent?: {
      provider?: ProviderName;
      model?: string;
    };
    policy?: {
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
      bots?: Partial<Record<BotRole, {
        clientId?: string;
        appId?: string;
      }>>;
    };
    discord?: {
      clientId?: string;
      publicKey?: string;
      redirectUri?: string;
      bots?: Partial<Record<BotRole, {
        clientId?: string;
        publicKey?: string;
      }>>;
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
      clientId?: string;
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
  MURPH_DISTRIBUTION: (config, value) => setPath(config, ['app', 'distribution'], runtimeDistributionFromString(value)),
  MURPH_PRODUCT_MODE: (config, value) => setPath(config, ['app', 'productMode'], productModeFromString(value)),
  MURPH_APP_URL: (config, value) => setPath(config, ['app', 'url'], value),
  MURPH_SQLITE_PATH: (config, value) => setPath(config, ['app', 'sqlitePath'], value),
  MURPH_HEARTBEAT_INTERVAL_MS: (config, value) => setPath(config, ['app', 'heartbeatIntervalMs'], numberFromString(value)),
  MURPH_RUN_EVENT_RETENTION_DAYS: (config, value) => setPath(config, ['app', 'runEventRetentionDays'], numberFromString(value)),
  MURPH_CONTEXT_SOURCE_TIMEOUT_MS: (config, value) => setPath(config, ['app', 'contextSourceTimeoutMs'], numberFromString(value)),
  MURPH_CONTEXT_SOURCE_MAX_OPTIONAL: (config, value) => setPath(config, ['app', 'contextSourceMaxOptional'], numberFromString(value)),
  MURPH_SOURCE_INDEX_ENABLED: (config, value) => setPath(config, ['app', 'sourceIndexEnabled'], booleanFromString(value)),
  MURPH_SOURCE_INDEX_INTERVAL_MS: (config, value) => setPath(config, ['app', 'sourceIndexIntervalMs'], numberFromString(value)),
  MURPH_SOURCE_INDEX_RETRY_INTERVAL_MS: (config, value) => setPath(config, ['app', 'sourceIndexRetryIntervalMs'], numberFromString(value)),
  MURPH_TIMEZONE: (config, value) => setPath(config, ['app', 'timezone'], value),
  MURPH_WORKDAY_START_HOUR: (config, value) => setPath(config, ['app', 'workdayStartHour'], numberFromString(value)),
  MURPH_WORKDAY_END_HOUR: (config, value) => setPath(config, ['app', 'workdayEndHour'], numberFromString(value)),
  MURPH_DEFAULT_PROVIDER: (config, value) => setPath(config, ['ai', 'defaultProvider'], providerFromString(value)),
  MURPH_DEFAULT_MODEL: (config, value) => setPath(config, ['ai', 'defaultModel'], value),
  MURPH_AGENT_PROVIDER: (config, value) => setPath(config, ['ai', 'agent', 'provider'], providerFromString(value)),
  MURPH_AGENT_MODEL: (config, value) => setPath(config, ['ai', 'agent', 'model'], value),
  MURPH_POLICY_PROVIDER: (config, value) => setPath(config, ['ai', 'policy', 'provider'], providerFromString(value)),
  MURPH_POLICY_MODEL: (config, value) => setPath(config, ['ai', 'policy', 'model'], value),
  NOTION_VERSION: (config, value) => setPath(config, ['integrations', 'notion', 'version'], value),
  NOTION_MAX_RESULTS: (config, value) => setPath(config, ['integrations', 'notion', 'maxResults'], numberFromString(value)),
  GITHUB_REPOSITORIES: (config, value) => setPath(config, ['integrations', 'github', 'repositories'], csvFromString(value)),
  GOOGLE_CLIENT_ID: (config, value) => setPath(config, ['integrations', 'google', 'clientId'], value),
  GOOGLE_CALENDAR_ID: (config, value) => setPath(config, ['integrations', 'google', 'calendarId'], value),
  OBSIDIAN_VAULT_PATH: (config, value) => setPath(config, ['integrations', 'obsidian', 'vaultPath'], value),
  MURPH_WEB_SEARCH_BACKEND: (config, value) => setPath(config, ['integrations', 'webSearch', 'backend'], value === 'brave' ? 'brave' : 'tavily'),
  MURPH_FILE_READ_ALLOWED_ROOTS: (config, value) => setPath(config, ['integrations', 'localTools', 'fileReadAllowedRoots'], csvFromString(value)),
  MURPH_SHELL_ALLOWED_COMMANDS_JSON: (config, value) => setPath(config, ['integrations', 'localTools', 'shellAllowedCommandsJson'], value)
};

export const SETUP_CONFIG_KEYS = new Set(Object.keys(CONFIG_KEY_SETTERS));

const CONFIG_KEY_CLEARERS: Record<string, (config: Record<string, unknown>) => void> = {
  MURPH_AGENT_PROVIDER: (config) => deletePath(config, ['ai', 'agent', 'provider']),
  MURPH_AGENT_MODEL: (config) => deletePath(config, ['ai', 'agent', 'model']),
  MURPH_POLICY_PROVIDER: (config) => deletePath(config, ['ai', 'policy', 'provider']),
  MURPH_POLICY_MODEL: (config) => deletePath(config, ['ai', 'policy', 'model']),
  OBSIDIAN_VAULT_PATH: (config) => deletePath(config, ['integrations', 'obsidian', 'vaultPath'])
};

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

function booleanValue(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function providerValue(value: unknown): ProviderName | undefined {
  return value === 'anthropic' ? 'anthropic' : value === 'openai' ? 'openai' : undefined;
}

export function normalizeProductMode(value: unknown): ProductMode | undefined {
  return value === 'channel' ? 'channel' : undefined;
}

export function normalizeRuntimeDistribution(value: unknown): RuntimeDistribution | undefined {
  return value === 'team' ? 'team' : undefined;
}

function runtimeDistributionFromString(value: string): RuntimeDistribution {
  const normalized = normalizeRuntimeDistribution(value);
  if (normalized) return normalized;
  throw new Error(`Murph Personal is no longer a supported runtime. Expected runtime distribution to be team, received: ${value}`);
}

export function distributionFromProductMode(value: ProductMode | undefined): RuntimeDistribution | undefined {
  return value === 'channel' ? 'team' : undefined;
}

export function productModeFromDistribution(value: RuntimeDistribution): ProductMode {
  return 'channel';
}

function productModeFromString(value: string): ProductMode {
  const normalized = normalizeProductMode(value);
  if (normalized) return normalized;
  throw new Error(`Murph Personal is no longer a supported runtime. Expected product mode to be channel, received: ${value}`);
}

function booleanFromString(value: string): boolean {
  if (/^(true|yes|1|on)$/i.test(value)) return true;
  if (/^(false|no|0|off)$/i.test(value)) return false;
  throw new Error(`Expected boolean value, received: ${value}`);
}

function stringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const values = value.map((entry) => stringValue(entry)).filter((entry): entry is string => Boolean(entry));
  return values.length > 0 ? values : [];
}

function normalizeBotRole(value: unknown): BotRole | undefined {
  return value === 'channel' ? 'channel' : undefined;
}

function botRolesFromString(value: string): BotRole[] {
  const roles = value
    .split(',')
    .map((entry) => normalizeBotRole(entry.trim()))
    .filter((entry): entry is BotRole => Boolean(entry));
  return Array.from(new Set(roles)).length > 0 ? Array.from(new Set(roles)) : ['channel'];
}

function botRolesValue(value: unknown): BotRole[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const roles = value
    .map(normalizeBotRole)
    .filter((entry): entry is BotRole => Boolean(entry));
  return roles.length > 0 ? Array.from(new Set(roles)) : undefined;
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
  const workspaceOwnersRaw = value.workspaceOwners;
  const workspaceOwners = Array.isArray(workspaceOwnersRaw)
    ? workspaceOwnersRaw
        .filter(isRecord)
        .map((owner) => ({
          workspaceId: stringValue(owner.workspaceId) ?? '',
          ownerUserId: stringValue(owner.ownerUserId) ?? '',
          ownerDisplayName: stringValue(owner.ownerDisplayName)
        }))
        .filter((owner) => owner.workspaceId && owner.ownerUserId)
    : undefined;
  const workspaceChannelsRaw = value.workspaceChannels;
  const workspaceChannels = Array.isArray(workspaceChannelsRaw)
    ? workspaceChannelsRaw
        .filter(isRecord)
        .map((entry) => {
          const entryChannelsRaw = entry.selectedChannels;
          const entryChannels = Array.isArray(entryChannelsRaw)
            ? entryChannelsRaw
                .filter(isRecord)
                .map((channel) => ({
                  id: stringValue(channel.id) ?? '',
                  displayName: stringValue(channel.displayName) ?? stringValue(channel.id) ?? ''
                }))
                .filter((channel) => channel.id && channel.displayName)
            : [];
          const entryMode = entry.channelScopeMode === 'all_accessible' ? 'all_accessible' as const : 'selected' as const;
          return {
            workspaceId: stringValue(entry.workspaceId) ?? '',
            channelScopeMode: entryMode,
            selectedChannels: entryMode === 'selected' ? entryChannels : []
          };
        })
        .filter((entry) => entry.workspaceId && (entry.channelScopeMode === 'all_accessible' || entry.selectedChannels.length > 0))
    : undefined;
  return {
    botRoles: botRolesValue(value.botRoles),
    providerBotRoles: normalizeProviderBotRoleMap(value.providerBotRoles),
    channelProvider: stringValue(value.channelProvider),
    workspaceId: stringValue(value.workspaceId),
    ownerUserId: stringValue(value.ownerUserId),
    ownerDisplayName: stringValue(value.ownerDisplayName),
    workspaceOwners,
    workspaceChannels,
    channelScopeMode: value.channelScopeMode === 'all_accessible' ? 'all_accessible' : value.channelScopeMode === 'selected' ? 'selected' : undefined,
    selectedChannels,
    timezone: stringValue(value.timezone),
    workdayStartHour: numberValue(value.workdayStartHour),
    workdayEndHour: numberValue(value.workdayEndHour)
  };
}

function rolesForDistribution(distribution: RuntimeDistribution | undefined): BotRole[] {
  return ['channel'];
}

function constrainRolesToDistribution(roles: BotRole[] | undefined, distribution: RuntimeDistribution | undefined): BotRole[] {
  const allowed = new Set(rolesForDistribution(distribution));
  const constrained = (roles ?? rolesForDistribution(distribution)).filter((role) => allowed.has(role));
  return constrained.length > 0 ? Array.from(new Set(constrained)) : rolesForDistribution(distribution);
}

function constrainProviderRolesToDistribution(
  rolesByProvider: Record<string, BotRole[]> | undefined,
  distribution: RuntimeDistribution | undefined
): Record<string, BotRole[]> | undefined {
  if (!rolesByProvider) return undefined;
  const constrained = Object.fromEntries(
    Object.entries(rolesByProvider).map(([provider, roles]) => [
      provider,
      Array.from(new Set(roles.filter((role) => rolesForDistribution(distribution).includes(role))))
    ])
  );
  return Object.keys(constrained).length > 0 ? constrained : undefined;
}

function setupDefaultsWithEnv(value: unknown, distribution: RuntimeDistribution | undefined): SetupDefaults | undefined {
  const defaults = setupDefaultsValue(value) ?? {};
  const envBotRoles = process.env.MURPH_BOT_ROLES?.trim();
  return {
    ...defaults,
    botRoles: constrainRolesToDistribution(
      envBotRoles ? botRolesFromString(envBotRoles) : defaults.botRoles,
      distribution
    ),
    providerBotRoles: constrainProviderRolesToDistribution(defaults.providerBotRoles, distribution)
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
  const policyAi = isRecord(ai.policy) ? ai.policy : {};
  const channels = isRecord(raw.channels) ? raw.channels : {};
  const slack = isRecord(channels.slack) ? channels.slack : {};
  const slackBots = isRecord(slack.bots) ? slack.bots : {};
  const slackChannelBot = isRecord(slackBots.channel) ? slackBots.channel : {};
  const slackPersonalBot = isRecord(slackBots.personal) ? slackBots.personal : {};
  const discord = isRecord(channels.discord) ? channels.discord : {};
  const discordBots = isRecord(discord.bots) ? discord.bots : {};
  const discordChannelBot = isRecord(discordBots.channel) ? discordBots.channel : {};
  const discordPersonalBot = isRecord(discordBots.personal) ? discordBots.personal : {};
  const integrations = isRecord(raw.integrations) ? raw.integrations : {};
  const notion = isRecord(integrations.notion) ? integrations.notion : {};
  const github = isRecord(integrations.github) ? integrations.github : {};
  const google = isRecord(integrations.google) ? integrations.google : {};
  const obsidian = isRecord(integrations.obsidian) ? integrations.obsidian : {};
  const webSearch = isRecord(integrations.webSearch) ? integrations.webSearch : {};
  const localTools = isRecord(integrations.localTools) ? integrations.localTools : {};
  const policy = isRecord(raw.policy) ? raw.policy : {};
  const explicitDistribution =
    normalizeRuntimeDistribution(process.env.MURPH_DISTRIBUTION) ??
    normalizeRuntimeDistribution(app.distribution);
  const legacyProductMode =
    normalizeProductMode(process.env.MURPH_PRODUCT_MODE) ??
    normalizeProductMode(app.productMode);
  const appDistribution =
    explicitDistribution ??
    distributionFromProductMode(legacyProductMode);
  const appProductMode = appDistribution
    ? productModeFromDistribution(appDistribution)
    : legacyProductMode;

  return {
    app: {
      distribution: appDistribution,
      productMode: appProductMode,
      url: stringValue(app.url),
      sqlitePath: stringValue(app.sqlitePath),
      heartbeatIntervalMs: numberValue(app.heartbeatIntervalMs),
      runEventRetentionDays: numberValue(app.runEventRetentionDays),
      contextSourceTimeoutMs: numberValue(app.contextSourceTimeoutMs),
      contextSourceMaxOptional: numberValue(app.contextSourceMaxOptional),
      sourceIndexEnabled: booleanValue(app.sourceIndexEnabled),
      sourceIndexIntervalMs: numberValue(app.sourceIndexIntervalMs),
      sourceIndexRetryIntervalMs: numberValue(app.sourceIndexRetryIntervalMs),
      timezone: stringValue(app.timezone),
      workdayStartHour: numberValue(app.workdayStartHour),
      workdayEndHour: numberValue(app.workdayEndHour)
    },
    ai: {
      defaultProvider: providerValue(ai.defaultProvider),
      defaultModel: stringValue(ai.defaultModel),
      agent: {
        provider: providerValue(agent.provider),
        model: stringValue(agent.model)
      },
      policy: {
        provider: providerValue(policyAi.provider),
        model: stringValue(policyAi.model)
      }
    },
    channels: {
      slack: {
        eventsMode: slack.eventsMode === 'http' ? 'http' : slack.eventsMode === 'socket' ? 'socket' : undefined,
        clientId: stringValue(slack.clientId),
        appId: stringValue(slack.appId),
        teamId: stringValue(slack.teamId),
        teamName: stringValue(slack.teamName),
        bots: {
          channel: {
            clientId: stringValue(slackChannelBot.clientId),
            appId: stringValue(slackChannelBot.appId)
          },
          personal: {
            clientId: stringValue(slackPersonalBot.clientId),
            appId: stringValue(slackPersonalBot.appId)
          }
        }
      },
      discord: {
        clientId: stringValue(discord.clientId),
        publicKey: stringValue(discord.publicKey),
        redirectUri: stringValue(discord.redirectUri),
        bots: {
          channel: {
            clientId: stringValue(discordChannelBot.clientId),
            publicKey: stringValue(discordChannelBot.publicKey)
          },
          personal: {
            clientId: stringValue(discordPersonalBot.clientId),
            publicKey: stringValue(discordPersonalBot.publicKey)
          }
        }
      }
    },
    setup: setupDefaultsWithEnv(raw.setup, appDistribution),
    integrations: {
      notion: {
        version: stringValue(notion.version),
        maxResults: numberValue(notion.maxResults)
      },
      github: {
        repositories: stringArray(github.repositories)
      },
      google: {
        clientId: stringValue(google.clientId),
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

export function pruneChannelRuntimeConfig(cwd = process.cwd()): void {
  const raw = readRawConfig(cwd);
  deletePath(raw, ['setup']);
  deletePath(raw, ['channels', 'slack']);
  deletePath(raw, ['channels', 'discord']);
  const channels = raw.channels;
  if (isRecord(channels) && Object.keys(channels).length === 0) {
    delete raw.channels;
  }
  writeRawConfig(raw, cwd);
}

export function updateMurphPolicyProfile(profileName: string | undefined, cwd = process.cwd()): void {
  const raw = readRawConfig(cwd);
  setPath(raw, ['policy', 'profile'], profileName);
  writeRawConfig(raw, cwd);
}

export function updateMurphPolicyConfig(input: {
  profileName?: string;
}, cwd = process.cwd()): void {
  const raw = readRawConfig(cwd);
  if (Object.prototype.hasOwnProperty.call(input, 'profileName')) {
    setPath(raw, ['policy', 'profile'], input.profileName);
  }
  deletePath(raw, ['policy', 'mode']);
  writeRawConfig(raw, cwd);
}
