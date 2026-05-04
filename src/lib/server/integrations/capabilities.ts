import { getStore } from '#lib/server/persistence/store';
import type { IntegrationDefinition } from './registry.js';
import { INTEGRATIONS, readEnvCredential } from './registry.js';

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
 * For each integration whose credential is present (DB or env), unions its tools/contextSources
 * into the workspace's enabled lists. Idempotent.
 */
export function reconcileIntegrationCapabilitiesForWorkspace(workspaceId: string): void {
  const store = getStore();
  for (const definition of INTEGRATIONS) {
    const stored = store.getIntegrationCredential(workspaceId, definition.provider);
    const hasDbCred = stored?.status === 'connected';
    const hasEnvCred = Boolean(readEnvCredential(definition.provider));
    if (hasDbCred || hasEnvCred) {
      enableIntegrationCapabilities(workspaceId, definition);
    }
  }
}
