import { getContextSourceRegistry } from '#lib/server/capabilities/context-source-registry';
import { getToolRegistry } from '#lib/server/capabilities/tool-registry';
import { registerEnvCredential } from './env-credentials.js';
import type { IntegrationAdapter } from './adapter.js';

type AdapterSource = 'builtin' | 'user';
type AdapterStatus = 'loaded' | 'failed' | 'skipped';

interface RegisteredAdapter {
  adapter: IntegrationAdapter;
  source: AdapterSource;
  filePath?: string;
}

export interface IntegrationAdapterStatus {
  id: string;
  name?: string;
  source: AdapterSource;
  status: AdapterStatus;
  filePath?: string;
  error?: string;
  capabilities?: {
    tools: string[];
    contextSources: string[];
  };
}

const adapters = new Map<string, RegisteredAdapter>();
const statuses = new Map<string, IntegrationAdapterStatus>();

function statusKey(adapterId: string, source: AdapterSource, filePath?: string): string {
  return filePath ?? `${source}:${adapterId}`;
}

export function registerAdapter(
  adapter: IntegrationAdapter,
  opts: { source: AdapterSource; filePath?: string }
): void {
  if (!adapter.id || !/^[a-z0-9][a-z0-9._-]*$/i.test(adapter.id)) {
    throw new Error(`Invalid integration adapter id: ${adapter.id || '<empty>'}`);
  }

  if (adapters.has(adapter.id)) {
    throw new Error(`Integration adapter already registered: ${adapter.id}`);
  }

  registerEnvCredential(adapter.id, adapter.credential.envKey);

  const toolRegistry = getToolRegistry();
  const contextSourceRegistry = getContextSourceRegistry();
  for (const source of adapter.contextSources ?? []) {
    if (contextSourceRegistry.has(source.name)) {
      throw new Error(`Context source already registered: ${source.name}`);
    }
  }
  for (const tool of adapter.tools ?? []) {
    if (toolRegistry.has(tool.name)) {
      throw new Error(`Tool already registered: ${tool.name}`);
    }
  }

  const registrySource = opts.source === 'builtin' ? 'core' : 'adapter';
  for (const source of adapter.contextSources ?? []) {
    contextSourceRegistry.register(source, {
      optional: source.optional,
      source: registrySource
    });
  }
  for (const tool of adapter.tools ?? []) {
    toolRegistry.register(tool, {
      optional: tool.optional,
      source: registrySource
    });
  }

  adapters.set(adapter.id, {
    adapter,
    source: opts.source,
    filePath: opts.filePath
  });
  statuses.set(statusKey(adapter.id, opts.source, opts.filePath), {
    id: adapter.id,
    name: adapter.name,
    source: opts.source,
    status: 'loaded',
    filePath: opts.filePath,
    capabilities: {
      tools: (adapter.tools ?? []).map((tool) => tool.name),
      contextSources: (adapter.contextSources ?? []).map((source) => source.name)
    }
  });
}

export function recordAdapterLoadFailure(input: {
  id: string;
  source: AdapterSource;
  filePath?: string;
  error: string;
  status?: AdapterStatus;
}): void {
  statuses.set(statusKey(input.id, input.source, input.filePath), {
    id: input.id,
    source: input.source,
    status: input.status ?? 'failed',
    filePath: input.filePath,
    error: input.error
  });
}

export function getAdapter(id: string): IntegrationAdapter | undefined {
  return adapters.get(id)?.adapter;
}

export function listAdapters(): IntegrationAdapter[] {
  return [...adapters.values()].map((registered) => registered.adapter);
}

export function listAdapterStatuses(): IntegrationAdapterStatus[] {
  return [...statuses.values()];
}
