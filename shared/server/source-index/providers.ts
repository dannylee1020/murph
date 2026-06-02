import { listIntegrations } from '../integrations/registry.js';
import { getRuntimeEnv } from '../util/env.js';
import { indexGitHubSource } from './indexers/github.js';
import { indexGranolaSource } from './indexers/granola.js';
import { indexLinearSource } from './indexers/linear.js';
import { indexNotionSource } from './indexers/notion.js';
import { indexObsidianSource } from './indexers/obsidian.js';

export interface SourceIndexProviderRunResult {
  resourceCount: number;
  changedPaths: string[];
  cursor?: string;
}

export interface SourceIndexProviderDefinition {
  provider: string;
  index(workspaceId: string): Promise<SourceIndexProviderRunResult>;
}

const PROVIDERS: Record<string, SourceIndexProviderDefinition> = {
  github: {
    provider: 'github',
    index: indexGitHubSource
  },
  notion: {
    provider: 'notion',
    index: indexNotionSource
  },
  linear: {
    provider: 'linear',
    index: indexLinearSource
  },
  granola: {
    provider: 'granola',
    index: indexGranolaSource
  },
  obsidian: {
    provider: 'obsidian',
    index: indexObsidianSource
  }
};

export function sourceIndexProviderIdsForCurrentRuntime(): string[] {
  const { distribution } = getRuntimeEnv();
  return listIntegrations({ distribution })
    .map((integration) => integration.provider)
    .filter((provider) => provider !== 'google' && Boolean(PROVIDERS[provider]));
}

export function getSourceIndexProvider(provider: string): SourceIndexProviderDefinition | undefined {
  return PROVIDERS[provider];
}

export function validateSourceIndexProvidersForCurrentRuntime(providers: string[]): string[] {
  const available = new Set(sourceIndexProviderIdsForCurrentRuntime());
  const unsupported = providers.filter((provider) => !available.has(provider));
  if (unsupported.length > 0) {
    throw new Error(`Unsupported source index provider: ${unsupported.join(', ')}`);
  }
  return [...new Set(providers)];
}
