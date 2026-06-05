export const APP_NAME = 'Murph';

export const V0_ALLOWED_ACTIONS = [
  'reply',
  'ask',
  'redirect',
  'defer',
  'remind',
  'abstain'
] as const;

export const DEFAULT_HEARTBEAT_INTERVAL_MS = 15 * 60 * 1000;
export const DEFAULT_SOURCE_INDEX_INTERVAL_MS = 24 * 60 * 60 * 1000;
export const DEFAULT_SOURCE_INDEX_RETRY_INTERVAL_MS = 60 * 60 * 1000;

export const MEMORY_ROOT = 'memory';
export const SKILLS_ROOT = 'skills/runtime';
export const USER_SKILLS_ROOT = 'skills';
export const POLICIES_ROOT = 'policies';
export const PLUGINS_ROOT = 'plugins';
export const DEFAULT_SQLITE_PATH = 'data/murph.sqlite';
export const DEFAULT_PROVIDER_MODEL: Record<'openai' | 'anthropic', string> = {
  openai: 'gpt-5.5',
  anthropic: 'claude-opus-4-7'
};
export const DEFAULT_AGENT_MODEL = DEFAULT_PROVIDER_MODEL;
export const DEFAULT_AUTO_SEND_ACTIONS = ['reply', 'ask', 'redirect', 'defer'] as const;
