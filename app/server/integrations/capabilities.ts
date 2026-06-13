import { getStore } from '#app/server/persistence/store';
import { getRuntimeEnv } from '#app/server/util/env';
import type { CredentialRecord } from '#app/server/credentials/local-store';
import type { IntegrationDefinition } from './registry.js';
import { integrationAvailableFor, listIntegrations, readEnvCredential } from './registry.js';
import {
  globalIntegrationCredential,
  integrationCredentialKey,
} from './global-scope.js';
import { getObsidianConnectionStatus } from '#app/server/context-sources/obsidian';
import { getToolRegistry } from '#app/server/capabilities/tool-registry';
import { getContextSourceRegistry } from '#app/server/capabilities/context-source-registry';

export const MISSING_INTEGRATION_CREDENTIAL_MESSAGE = 'Local credential is missing. Reconnect this integration.';

export interface EffectiveIntegrationCredential {
  local?: CredentialRecord;
  envValue?: string;
  source?: 'credentials' | 'config' | 'env';
}

const CHANNEL_PROVIDER_CAPABILITIES: Record<string, Pick<IntegrationDefinition, 'tools' | 'contextSources'>> = {
  slack: {
    tools: ['slack.search', 'slack.read_thread'],
    contextSources: ['slack.thread_search']
  }
};
const DEPRECATED_CAPABILITY_IDS = new Set([
  'linear.search',
  'linear.getIssue',
  'Linear issues'
]);

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

function filterKnown(existing: string[], known: Set<string>): string[] {
  return existing.filter((value) => known.has(value) && !DEPRECATED_CAPABILITY_IDS.has(value));
}

function knownCapabilityIds(): { tools: Set<string>; contextSources: Set<string> } {
  const tools = new Set<string>();
  const contextSources = new Set<string>();

  for (const capabilities of Object.values(CHANNEL_PROVIDER_CAPABILITIES)) {
    for (const tool of capabilities.tools) tools.add(tool);
    for (const source of capabilities.contextSources) contextSources.add(source);
  }

  for (const definition of listIntegrations({ includeUnavailable: true })) {
    for (const tool of definition.tools) tools.add(tool);
    for (const source of definition.contextSources) contextSources.add(source);
  }

  for (const tool of getToolRegistry().list()) tools.add(tool.name);
  for (const source of getContextSourceRegistry().list()) contextSources.add(source.name);

  return { tools, contextSources };
}

function pruneUnknownWorkspaceCapabilities(workspaceId: string): void {
  const store = getStore();
  const memory = store.getOrCreateWorkspaceMemory(workspaceId);
  const known = knownCapabilityIds();
  const enabledOptionalTools = filterKnown(memory.enabledOptionalTools, known.tools);
  const enabledContextSources = filterKnown(memory.enabledContextSources, known.contextSources);

  if (
    enabledOptionalTools.length === memory.enabledOptionalTools.length &&
    enabledContextSources.length === memory.enabledContextSources.length
  ) {
    return;
  }

  store.upsertWorkspaceMemory({
    ...memory,
    enabledOptionalTools,
    enabledContextSources
  });
}

function normalizeRepositories(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => typeof entry === 'string' ? entry.trim() : '')
    .filter((entry) => /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(entry));
}

function githubHasRepositoryScope(workspaceId: string): boolean {
  const key = integrationCredentialKey({ credentialKind: 'api_key' });
  const localRepositories = normalizeRepositories(globalIntegrationCredential('github', key)?.metadata?.repositories);
  if (localRepositories.length > 0) {
    return true;
  }

  const connectionRepositories = normalizeRepositories(
    getStore().getIntegrationConnection(workspaceId, 'github')?.metadata?.repositories
  );
  return connectionRepositories.length > 0 || getRuntimeEnv().githubRepositories.length > 0;
}

export function effectiveIntegrationCredential(
  definition: Pick<IntegrationDefinition, 'provider' | 'credentialKind'>,
  workspaceId: string
): EffectiveIntegrationCredential {
  const pathStatus = definition.credentialKind === 'config_path' && definition.provider === 'obsidian'
    ? getObsidianConnectionStatus()
    : undefined;
  const envValue = pathStatus?.source === 'env'
    ? pathStatus.vaultPath
    : readEnvCredential(definition.provider);
  const key = integrationCredentialKey(definition);
  const local = definition.credentialKind === 'config_path'
    ? undefined
    : globalIntegrationCredential(definition.provider, key);
  const source = local ? 'credentials' : pathStatus?.source ?? (envValue ? 'env' : undefined);

  return { local, envValue, source };
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

export function enableIntegrationCapabilitiesForAllWorkspaces(
  definition: Pick<IntegrationDefinition, 'tools' | 'contextSources'>
): void {
  const store = getStore();
  for (const workspace of store.listWorkspaces()) {
    enableIntegrationCapabilities(workspace.id, definition);
  }
}

export function disableIntegrationCapabilitiesForAllWorkspaces(
  definition: Pick<IntegrationDefinition, 'tools' | 'contextSources'>
): void {
  const store = getStore();
  for (const workspace of store.listWorkspaces()) {
    disableIntegrationCapabilities(workspace.id, definition);
  }
}

/**
 * Reconciles workspace memory with currently effective integration credentials.
 * Enabled integrations get their tools/contextSources unioned into workspace memory.
 * Stale connections without an effective credential are removed from memory and marked for reconnect.
 */
export function reconcileIntegrationCapabilitiesForWorkspace(workspaceId: string): void {
  pruneUnknownWorkspaceCapabilities(workspaceId);

  const store = getStore();
  const workspace = store.getWorkspaceById(workspaceId);
  const channelCapabilities = workspace ? CHANNEL_PROVIDER_CAPABILITIES[workspace.provider] : undefined;
  if (channelCapabilities) {
    enableIntegrationCapabilities(workspaceId, channelCapabilities);
  }

  const distribution = getRuntimeEnv().distribution;
  for (const definition of listIntegrations({ includeUnavailable: true })) {
    if (!integrationAvailableFor(definition, distribution)) {
      disableIntegrationCapabilities(workspaceId, definition);
      continue;
    }

    const effectiveCredential = effectiveIntegrationCredential(definition, workspaceId);
    const hasCredential = Boolean(effectiveCredential.source);
    if (definition.provider === 'github' && hasCredential && !githubHasRepositoryScope(workspaceId)) {
      disableIntegrationCapabilities(workspaceId, definition);
      continue;
    }
    if (hasCredential) {
      enableIntegrationCapabilities(workspaceId, definition);
      const stored = store.getIntegrationConnection(workspaceId, definition.provider);
      if (stored?.status === 'error') {
        store.saveIntegrationConnection({
          workspaceId,
          provider: definition.provider,
          credentialKind: definition.credentialKind,
          metadata: stored.metadata,
          status: 'connected'
        });
      }
      continue;
    }

    disableIntegrationCapabilities(workspaceId, definition);
    const stored = store.getIntegrationConnection(workspaceId, definition.provider);
    if (stored?.status === 'connected') {
      store.saveIntegrationConnection({
        workspaceId,
        provider: definition.provider,
        credentialKind: definition.credentialKind,
        metadata: stored.metadata,
        status: 'error',
        errorMessage: MISSING_INTEGRATION_CREDENTIAL_MESSAGE
      });
    }
  }
}
