import { SETUP_CONFIG_KEYS, updateMurphConfigValues } from '#lib/server/setup/config-file';
import { writeSecret } from '#lib/server/credentials/local-store';
import { resetRuntimeEnvCache } from '#lib/server/util/env';

const SETUP_SECRET_KEYS: Record<string, { provider: string; key: string }> = {
  OPENAI_API_KEY: { provider: 'openai', key: 'api_key' },
  ANTHROPIC_API_KEY: { provider: 'anthropic', key: 'api_key' },
  SLACK_APP_TOKEN: { provider: 'slack', key: 'app_token' },
  SLACK_CLIENT_SECRET: { provider: 'slack', key: 'client_secret' },
  SLACK_SIGNING_SECRET: { provider: 'slack', key: 'signing_secret' },
  SLACK_CHANNEL_APP_TOKEN: { provider: 'slack', key: 'channel_app_token' },
  SLACK_CHANNEL_CLIENT_SECRET: { provider: 'slack', key: 'channel_client_secret' },
  SLACK_CHANNEL_SIGNING_SECRET: { provider: 'slack', key: 'channel_signing_secret' },
  SLACK_PERSONAL_APP_TOKEN: { provider: 'slack', key: 'personal_app_token' },
  SLACK_PERSONAL_CLIENT_SECRET: { provider: 'slack', key: 'personal_client_secret' },
  SLACK_PERSONAL_SIGNING_SECRET: { provider: 'slack', key: 'personal_signing_secret' },
  DISCORD_BOT_TOKEN: { provider: 'discord', key: 'bot_token' },
  DISCORD_CLIENT_SECRET: { provider: 'discord', key: 'client_secret' },
  DISCORD_CHANNEL_BOT_TOKEN: { provider: 'discord', key: 'channel_bot_token' },
  DISCORD_CHANNEL_CLIENT_SECRET: { provider: 'discord', key: 'channel_client_secret' },
  DISCORD_PERSONAL_BOT_TOKEN: { provider: 'discord', key: 'personal_bot_token' },
  DISCORD_PERSONAL_CLIENT_SECRET: { provider: 'discord', key: 'personal_client_secret' },
  GOOGLE_ACCESS_TOKEN: { provider: 'google', key: 'access_token' },
  GOOGLE_CLIENT_SECRET: { provider: 'google', key: 'client_secret' },
  GITHUB_PAT: { provider: 'github', key: 'api_key' },
  NOTION_API_KEY: { provider: 'notion', key: 'api_key' },
  GRANOLA_API_KEY: { provider: 'granola', key: 'api_key' },
  TAVILY_API_KEY: { provider: 'tavily', key: 'api_key' },
  BRAVE_SEARCH_API_KEY: { provider: 'brave_search', key: 'api_key' }
};

export function updateSetupConfigValues(values: Record<string, string | undefined>): { updated: string[] } {
  const secretValues: Record<string, string | undefined> = {};
  const configValues: Record<string, string | undefined> = {};

  for (const [key, value] of Object.entries(values)) {
    if (SETUP_SECRET_KEYS[key]) {
      secretValues[key] = value;
    } else if (SETUP_CONFIG_KEYS.has(key)) {
      configValues[key] = value;
    } else {
      throw new Error(`Unsupported setup key: ${key}`);
    }
  }

  const updated: string[] = [];

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

  resetRuntimeEnvCache();
  updated.push(...configUpdated);

  return { updated };
}
