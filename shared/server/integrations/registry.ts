import { listAdapters } from './adapter-registry.js';
import { readEnvCredential } from './env-credentials.js';

export type IntegrationProvider = string;
export type IntegrationAuthType = 'api_key' | 'oauth' | 'path';

export interface IntegrationDefinition {
  provider: IntegrationProvider;
  name: string;
  description: string;
  authType: IntegrationAuthType;
  credentialKind: 'api_key' | 'oauth_bundle' | 'config_path';
  envKey: string;
  credentialLabel: string;
  installPath?: string;
  tools: string[];
  contextSources: string[];
}

export const INTEGRATIONS: IntegrationDefinition[] = [
  {
    provider: 'github',
    name: 'GitHub',
    description: 'Issues, pull requests, and repository context.',
    authType: 'api_key',
    credentialKind: 'api_key',
    envKey: 'GITHUB_PAT',
    credentialLabel: 'Personal access token',
    tools: ['github.search', 'github.read_issue', 'github.read_pr'],
    contextSources: ['github.thread_search']
  },
  {
    provider: 'notion',
    name: 'Notion',
    description: 'Team docs and knowledge pages.',
    authType: 'api_key',
    credentialKind: 'api_key',
    envKey: 'NOTION_API_KEY',
    credentialLabel: 'Integration token',
    tools: ['notion.search', 'notion.read_page'],
    contextSources: ['notion.thread_search']
  },
  {
    provider: 'granola',
    name: 'Granola',
    description: 'Meeting notes and transcripts.',
    authType: 'api_key',
    credentialKind: 'api_key',
    envKey: 'GRANOLA_API_KEY',
    credentialLabel: 'API key',
    tools: ['granola.search', 'granola.read_meeting'],
    contextSources: ['granola.thread_search']
  },
  {
    provider: 'obsidian',
    name: 'Obsidian',
    description: 'Local Markdown vault notes and knowledge base context.',
    authType: 'path',
    credentialKind: 'config_path',
    envKey: 'OBSIDIAN_VAULT_PATH',
    credentialLabel: 'Vault path',
    tools: ['obsidian.search', 'obsidian.read_note'],
    contextSources: ['obsidian.thread_search']
  },
  {
    provider: 'google',
    name: 'Google',
    description: 'Gmail threads and Google Calendar events.',
    authType: 'oauth',
    credentialKind: 'oauth_bundle',
    envKey: 'GOOGLE_ACCESS_TOKEN',
    credentialLabel: 'Google account',
    installPath: '/api/google/install',
    tools: ['gmail.search', 'gmail.read_thread', 'calendar.search_events', 'calendar.check_availability'],
    contextSources: ['gmail.thread_search', 'calendar.upcoming_events']
  }
];

export function listIntegrations(): IntegrationDefinition[] {
  const adapters = listAdapters();
  if (adapters.length === 0) {
    return INTEGRATIONS;
  }

  return adapters.map((adapter) => ({
    provider: adapter.id,
    name: adapter.name,
    description: adapter.description,
    authType: adapter.credential.authType,
    credentialKind: adapter.credential.credentialKind,
    envKey: adapter.credential.envKey,
    credentialLabel: adapter.credential.credentialLabel,
    installPath: adapter.credential.installPath,
    tools: (adapter.tools ?? []).map((tool) => tool.name),
    contextSources: (adapter.contextSources ?? []).map((source) => source.name)
  }));
}

export function getIntegration(provider: string): IntegrationDefinition | undefined {
  return listIntegrations().find((integration) => integration.provider === provider);
}

export { readEnvCredential };
