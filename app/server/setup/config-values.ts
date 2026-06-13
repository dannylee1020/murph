import { SETUP_CONFIG_KEYS, pruneChannelRuntimeConfig, updateMurphConfigValues } from '#app/server/setup/config-file';
import { writeSecret } from '#app/server/credentials/local-store';
import { getStore } from '#app/server/persistence/store';
import { normalizeSetupBotRoles } from '#app/server/setup/bot-roles';
import { validateSlackAppLevelToken } from './slack-tokens.js';
import { resetRuntimeEnvCache } from '#app/server/util/env';
import type { BotRole } from '#app/types';

const SETUP_SECRET_KEYS: Record<string, { provider: string; key: string }> = {
  OPENAI_API_KEY: { provider: 'openai', key: 'api_key' },
  ANTHROPIC_API_KEY: { provider: 'anthropic', key: 'api_key' },
  SLACK_APP_TOKEN: { provider: 'slack', key: 'app_token' },
  SLACK_CLIENT_SECRET: { provider: 'slack', key: 'client_secret' },
  SLACK_SIGNING_SECRET: { provider: 'slack', key: 'signing_secret' },
  SLACK_CHANNEL_APP_TOKEN: { provider: 'slack', key: 'channel_app_token' },
  SLACK_CHANNEL_CLIENT_SECRET: { provider: 'slack', key: 'channel_client_secret' },
  SLACK_CHANNEL_SIGNING_SECRET: { provider: 'slack', key: 'channel_signing_secret' },
  DISCORD_BOT_TOKEN: { provider: 'discord', key: 'bot_token' },
  DISCORD_CLIENT_SECRET: { provider: 'discord', key: 'client_secret' },
  DISCORD_CHANNEL_BOT_TOKEN: { provider: 'discord', key: 'channel_bot_token' },
  DISCORD_CHANNEL_CLIENT_SECRET: { provider: 'discord', key: 'channel_client_secret' },
  GITHUB_PAT: { provider: 'github', key: 'api_key' },
  NOTION_API_KEY: { provider: 'notion', key: 'api_key' },
  GRANOLA_API_KEY: { provider: 'granola', key: 'api_key' },
  TAVILY_API_KEY: { provider: 'tavily', key: 'api_key' },
  BRAVE_SEARCH_API_KEY: { provider: 'brave_search', key: 'api_key' }
};

const SLACK_APP_TOKEN_SETUP_KEYS = new Set([
  'SLACK_APP_TOKEN',
  'SLACK_CHANNEL_APP_TOKEN',
  'SLACK_PERSONAL_APP_TOKEN'
]);

function validateSetupSecretValue(key: string, value: string): void {
  if (!SLACK_APP_TOKEN_SETUP_KEYS.has(key)) return;
  const error = validateSlackAppLevelToken(value, key);
  if (error) {
    throw new Error(error);
  }
}

type BotAppConfigTarget = {
  provider: 'slack' | 'discord';
  role: BotRole | 'both';
  field: 'appId' | 'clientId' | 'publicKey' | 'eventsMode' | 'redirectUri' | 'teamId' | 'teamName';
};

const BOT_APP_CONFIG_KEYS: Record<string, BotAppConfigTarget> = {
  SLACK_EVENTS_MODE: { provider: 'slack', role: 'both', field: 'eventsMode' },
  SLACK_CLIENT_ID: { provider: 'slack', role: 'channel', field: 'clientId' },
  SLACK_APP_ID: { provider: 'slack', role: 'channel', field: 'appId' },
  SLACK_CHANNEL_CLIENT_ID: { provider: 'slack', role: 'channel', field: 'clientId' },
  SLACK_CHANNEL_APP_ID: { provider: 'slack', role: 'channel', field: 'appId' },
  SLACK_TEAM_ID: { provider: 'slack', role: 'both', field: 'teamId' },
  SLACK_TEAM_NAME: { provider: 'slack', role: 'both', field: 'teamName' },
  DISCORD_CLIENT_ID: { provider: 'discord', role: 'channel', field: 'clientId' },
  DISCORD_PUBLIC_KEY: { provider: 'discord', role: 'channel', field: 'publicKey' },
  DISCORD_CHANNEL_CLIENT_ID: { provider: 'discord', role: 'channel', field: 'clientId' },
  DISCORD_CHANNEL_PUBLIC_KEY: { provider: 'discord', role: 'channel', field: 'publicKey' },
  DISCORD_REDIRECT_URI: { provider: 'discord', role: 'both', field: 'redirectUri' }
};

function updateBotAppConfigValue(key: string, value: string): void {
  const target = BOT_APP_CONFIG_KEYS[key];
  if (!target) return;
  const roles: BotRole[] = target.role === 'both' ? ['channel'] : [target.role];
  for (const role of roles) {
    const existing = getStore().getBotAppConfig(target.provider, role);
    const input = {
      provider: target.provider,
      role,
      ...(target.field === 'appId' ? { appId: value } : {}),
      ...(target.field === 'clientId' ? { clientId: value, appId: target.provider === 'discord' ? value : undefined } : {}),
      ...(target.field === 'publicKey' ? { publicKey: value } : {}),
      ...(target.field === 'eventsMode' ? { eventsMode: value === 'http' ? 'http' as const : 'socket' as const } : {}),
      ...(target.field === 'redirectUri' ? { redirectUri: value } : {}),
      ...(target.field === 'teamId' ? { metadata: { ...(existing?.metadata ?? {}), teamId: value } } : {}),
      ...(target.field === 'teamName' ? { metadata: { ...(existing?.metadata ?? {}), teamName: value } } : {})
    };
    getStore().upsertBotAppConfig(input);
  }
}

function updateSetupDefaultValue(key: string, value: string): void {
  if (key !== 'MURPH_BOT_ROLES') return;
  const store = getStore();
  const current = store.getAppSettings().setupDefaults ?? {};
  store.upsertAppSettings({
    setupDefaults: {
      ...current,
      botRoles: normalizeSetupBotRoles(value.split(',').map((entry) => entry.trim()))
    }
  });
}

export function updateSetupConfigValues(values: Record<string, string | undefined>): { updated: string[] } {
  const secretValues: Record<string, string | undefined> = {};
  const configValues: Record<string, string | undefined> = {};
  const botAppConfigValues: Record<string, string | undefined> = {};
  const setupDefaultValues: Record<string, string | undefined> = {};

  for (const [key, value] of Object.entries(values)) {
    if (SETUP_SECRET_KEYS[key]) {
      secretValues[key] = value;
    } else if (BOT_APP_CONFIG_KEYS[key]) {
      botAppConfigValues[key] = value;
    } else if (key === 'MURPH_BOT_ROLES') {
      setupDefaultValues[key] = value;
    } else if (SETUP_CONFIG_KEYS.has(key)) {
      configValues[key] = value;
    } else {
      throw new Error(`Unsupported setup key: ${key}`);
    }
  }

  const updated: string[] = [];

  for (const [key, rawValue] of Object.entries(secretValues)) {
    const value = rawValue?.trim();
    if (value) {
      validateSetupSecretValue(key, value);
    }
  }

  for (const [key, rawValue] of Object.entries(secretValues)) {
    const value = rawValue?.trim();
    if (!value) {
      continue;
    }

    const target = SETUP_SECRET_KEYS[key];
    writeSecret(target.provider, target.key, value);
    process.env[key] = value;
    updated.push(key);
  }

  const configUpdated = updateMurphConfigValues(configValues).updated;
  for (const key of configUpdated) {
    const value = configValues[key]?.trim();
    if (value) {
      process.env[key] = value;
    } else {
      delete process.env[key];
    }
  }

  updated.push(...configUpdated);

  for (const [key, rawValue] of Object.entries(botAppConfigValues)) {
    const value = rawValue?.trim();
    if (!value) continue;
    updateBotAppConfigValue(key, value);
    process.env[key] = value;
    updated.push(key);
  }

  for (const [key, rawValue] of Object.entries(setupDefaultValues)) {
    const value = rawValue?.trim();
    if (!value) continue;
    updateSetupDefaultValue(key, value);
    process.env[key] = value;
    updated.push(key);
  }

  if (Object.keys(botAppConfigValues).length > 0 || Object.keys(setupDefaultValues).length > 0) {
    pruneChannelRuntimeConfig();
  }

  resetRuntimeEnvCache();

  return { updated };
}
