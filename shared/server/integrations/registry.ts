import { listAdapters } from './adapter-registry.js';
import { readEnvCredential } from './env-credentials.js';
import type { RuntimeDistribution } from '#shared/types';

export type IntegrationProvider = string;
export type IntegrationAuthType = 'api_key' | 'oauth' | 'path';
export type IntegrationDistribution = RuntimeDistribution;

const DEFAULT_DISTRIBUTIONS: IntegrationDistribution[] = ['team', 'personal'];

export interface IntegrationDefinition {
  provider: IntegrationProvider;
  name: string;
  description: string;
  distributions: IntegrationDistribution[];
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
    distributions: ['team', 'personal'],
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
    distributions: ['team', 'personal'],
    authType: 'api_key',
    credentialKind: 'api_key',
    envKey: 'NOTION_API_KEY',
    credentialLabel: 'Integration token',
    tools: ['notion.search', 'notion.read_page'],
    contextSources: ['notion.thread_search']
  },
  {
    provider: 'linear',
    name: 'Linear',
    description: 'Team issues, projects, and product work.',
    distributions: ['team', 'personal'],
    authType: 'api_key',
    credentialKind: 'api_key',
    envKey: 'LINEAR_API_KEY',
    credentialLabel: 'Linear API key',
    tools: ['linear.search_issues', 'linear.read_issue'],
    contextSources: ['linear.thread_search']
  },
  {
    provider: 'granola',
    name: 'Granola',
    description: 'Meeting notes and transcripts.',
    distributions: ['personal'],
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
    distributions: ['personal'],
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
    distributions: ['personal'],
    authType: 'oauth',
    credentialKind: 'oauth_bundle',
    envKey: 'GOOGLE_ACCESS_TOKEN',
    credentialLabel: 'Google account',
    installPath: '/api/google/install',
    tools: ['gmail.search', 'gmail.read_thread', 'calendar.search_events', 'calendar.check_availability'],
    contextSources: ['gmail.thread_search', 'calendar.upcoming_events']
  }
];

export interface IntegrationListOptions {
  distribution?: IntegrationDistribution;
  includeUnavailable?: boolean;
}

export function integrationAvailableFor(
  integration: Pick<IntegrationDefinition, 'distributions'>,
  distribution: IntegrationDistribution
): boolean {
  return integration.distributions.includes(distribution);
}

function filterByDistribution(
  integrations: IntegrationDefinition[],
  options: IntegrationListOptions = {}
): IntegrationDefinition[] {
  if (!options.distribution || options.includeUnavailable) {
    return integrations;
  }

  return integrations.filter((integration) => integrationAvailableFor(integration, options.distribution!));
}

export function listIntegrations(options: IntegrationListOptions = {}): IntegrationDefinition[] {
  const adapters = listAdapters();
  if (adapters.length === 0) {
    return filterByDistribution(INTEGRATIONS, options);
  }

  return filterByDistribution(adapters.map((adapter) => ({
    provider: adapter.id,
    name: adapter.name,
    description: adapter.description,
    distributions: adapter.distributions ?? DEFAULT_DISTRIBUTIONS,
    authType: adapter.credential.authType,
    credentialKind: adapter.credential.credentialKind,
    envKey: adapter.credential.envKey,
    credentialLabel: adapter.credential.credentialLabel,
    installPath: adapter.credential.installPath,
    tools: (adapter.tools ?? []).map((tool) => tool.name),
    contextSources: (adapter.contextSources ?? []).map((source) => source.name)
  })), options);
}

export function getIntegration(provider: string, options: IntegrationListOptions = {}): IntegrationDefinition | undefined {
  return listIntegrations(options).find((integration) => integration.provider === provider);
}

export { readEnvCredential };
