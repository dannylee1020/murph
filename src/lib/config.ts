export const APP_NAME = 'Nightclaw';

export const V0_ALLOWED_ACTIONS = [
  'reply',
  'ask',
  'redirect',
  'defer',
  'remind',
  'abstain'
] as const;

export const DEFAULT_HEARTBEAT_INTERVAL_MS = 15 * 60 * 1000;

export const MEMORY_ROOT = 'memory';
export const SKILLS_ROOT = 'skills';
export const POLICIES_ROOT = 'policies';
export const PLUGINS_ROOT = 'plugins';
export const DEFAULT_SQLITE_PATH = 'data/nightclaw.sqlite';
export const DEFAULT_PROVIDER_MODEL: Record<'openai' | 'anthropic', string> = {
  openai: 'gpt-5.4-mini',
  anthropic: 'claude-sonnet-4-6'
};
export const DEFAULT_AUTO_SEND_ACTIONS = ['reply', 'ask', 'redirect', 'defer'] as const;
