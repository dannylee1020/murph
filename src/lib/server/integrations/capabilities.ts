import { getStore } from '#lib/server/persistence/store';
import { hasSecret } from '#lib/server/credentials/local-store';
import type { IntegrationDefinition } from './registry.js';
import { listIntegrations, readEnvCredential } from './registry.js';

const CHANNEL_PROVIDER_CAPABILITIES: Record<string, Pick<IntegrationDefinition, 'tools' | 'contextSources'>> = {
  slack: {
    tools: ['slack.search', 'slack.read_thread'],
    contextSources: ['slack.thread_search']
  }
};

function unionUnique(existing: string[], additions: string[]): string[] {
  const set = new Set(existing);
  for (const value of additions) {
    set.add(value);
  }
  return [...set];
}

function difference(existing: string[], removals: string[]): string[] {
  const remove = new Set(removals);
  return existing.filter((value) => !remove.has(value));
}

export function enableIntegrationCapabilities(
  workspaceId: string,
  definition: Pick<IntegrationDefinition, 'tools' | 'contextSources'>
): void {
  const store = getStore();
  const memory = store.getOrCreateWorkspaceMemory(workspaceId);
  const nextTools = unionUnique(memory.enabledOptionalTools, definition.tools);
  const nextSources = unionUnique(memory.enabledContextSources, definition.contextSources);

  if (
    nextTools.length === memory.enabledOptionalTools.length &&
    nextSources.length === memory.enabledContextSources.length
  ) {
    return;
  }

  store.upsertWorkspaceMemory({
    ...memory,
    enabledOptionalTools: nextTools,
    enabledContextSources: nextSources
  });
}

export function disableIntegrationCapabilities(
  workspaceId: string,
  definition: Pick<IntegrationDefinition, 'tools' | 'contextSources'>
): void {
  const store = getStore();
  const memory = store.getOrCreateWorkspaceMemory(workspaceId);
  store.upsertWorkspaceMemory({
    ...memory,
    enabledOptionalTools: difference(memory.enabledOptionalTools, definition.tools),
    enabledContextSources: difference(memory.enabledContextSources, definition.contextSources)
  });
}

/**
 * Reconciles workspace memory with currently effective integration credentials.
 * For each integration whose credential is present (local store or env), unions its tools/contextSources
 * into the workspace's enabled lists. Idempotent.
 */
export function reconcileIntegrationCapabilitiesForWorkspace(workspaceId: string): void {
  const store = getStore();
  const workspace = store.getWorkspaceById(workspaceId);
  const channelCapabilities = workspace ? CHANNEL_PROVIDER_CAPABILITIES[workspace.provider] : undefined;
  if (channelCapabilities) {
    enableIntegrationCapabilities(workspaceId, channelCapabilities);
  }

  for (const definition of listIntegrations()) {
    const key = definition.credentialKind === 'oauth_bundle' ? 'oauth_bundle' : 'api_key';
    const hasLocalCred = hasSecret(definition.provider, key, { workspaceId }) ||
      hasSecret(definition.provider, key);
    const hasEnvCred = Boolean(readEnvCredential(definition.provider));
    if (hasLocalCred || hasEnvCred) {
      enableIntegrationCapabilities(workspaceId, definition);
    }
  }
}
