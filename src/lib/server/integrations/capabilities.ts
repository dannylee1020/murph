import { getStore } from '#lib/server/persistence/store';
import { getRuntimeEnv } from '#lib/server/util/env';
import type { IntegrationDefinition } from './registry.js';
import { listIntegrations, readEnvCredential } from './registry.js';
import { findGoogleOAuthRecord } from './google-oauth.js';
import {
  globalIntegrationCredential,
  integrationCredentialKey,
} from './global-scope.js';

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
    const key = integrationCredentialKey(definition);
    const hasLocalCred = definition.provider === 'google'
      ? Boolean(findGoogleOAuthRecord(workspaceId) || globalIntegrationCredential('google', 'access_token'))
      : Boolean(globalIntegrationCredential(definition.provider, key));
    const hasEnvCred = Boolean(readEnvCredential(definition.provider));
    if (definition.provider === 'github' && (hasLocalCred || hasEnvCred) && !githubHasRepositoryScope(workspaceId)) {
      disableIntegrationCapabilities(workspaceId, definition);
      continue;
    }
    if (hasLocalCred || hasEnvCred) {
      enableIntegrationCapabilities(workspaceId, definition);
    }
  }
}
