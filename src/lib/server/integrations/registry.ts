import { getRuntimeEnv } from '#lib/server/util/env';

export type IntegrationProvider = 'github' | 'notion' | 'granola' | 'google';
export type IntegrationAuthType = 'api_key' | 'oauth';

export interface IntegrationDefinition {
  provider: IntegrationProvider;
  name: string;
  description: string;
  authType: IntegrationAuthType;
  credentialKind: 'api_key' | 'oauth_bundle';
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
    provider: 'google',
    name: 'Google',
    description: 'Gmail threads and Google Calendar events.',
    authType: 'oauth',
    credentialKind: 'oauth_bundle',
    envKey: 'GOOGLE_ACCESS_TOKEN',
    credentialLabel: 'Google account',
    installPath: '/api/google/install',
    tools: ['gmail.search', 'gmail.read_thread', 'calendar.search_events'],
    contextSources: ['gmail.thread_search', 'calendar.upcoming_events']
  }
];

export function getIntegration(provider: string): IntegrationDefinition | undefined {
  return INTEGRATIONS.find((integration) => integration.provider === provider);
}

export function readEnvCredential(provider: string): string | undefined {
  const env = getRuntimeEnv();
  switch (provider) {
    case 'github':
      return env.githubPat;
    case 'notion':
      return env.notionApiKey;
    case 'granola':
      return env.granolaApiKey;
    case 'google':
      return env.googleAccessToken;
    default:
      return undefined;
  }
}
