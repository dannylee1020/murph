import { getRuntimeEnv } from '#lib/server/util/env';

export type IntegrationAuthType = 'api_key';

export interface IntegrationDefinition {
  provider: 'github' | 'notion';
  name: string;
  authType: IntegrationAuthType;
  credentialKind: 'api_key';
  envKey: 'GITHUB_PAT' | 'NOTION_API_KEY';
  tools: string[];
  contextSources: string[];
}

export const INTEGRATIONS: IntegrationDefinition[] = [
  {
    provider: 'github',
    name: 'GitHub',
    authType: 'api_key',
    credentialKind: 'api_key',
    envKey: 'GITHUB_PAT',
    tools: ['github.search', 'github.read_issue', 'github.read_pr'],
    contextSources: ['github.thread_search']
  },
  {
    provider: 'notion',
    name: 'Notion',
    authType: 'api_key',
    credentialKind: 'api_key',
    envKey: 'NOTION_API_KEY',
    tools: ['notion.search', 'notion.read_page'],
    contextSources: ['notion.thread_search']
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
    default:
      return undefined;
  }
}
