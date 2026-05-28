import { getStore } from '#shared/server/persistence/store';
import {
  deleteSecret,
  listSecrets,
  readSecretRecord,
  type CredentialRecord,
  type SecretRef
} from '#shared/server/credentials/local-store';
import type { IntegrationDefinition } from './registry.js';

export function integrationCredentialKey(definition: Pick<IntegrationDefinition, 'credentialKind'>): string {
  if (definition.credentialKind === 'config_path') {
    return 'config_path';
  }
  return definition.credentialKind === 'oauth_bundle' ? 'oauth_bundle' : 'api_key';
}

export function globalIntegrationCredential(provider: string, key: string): CredentialRecord | undefined {
  return readSecretRecord(provider, key);
}

export function deleteIntegrationCredentialEverywhere(provider: string, key: string): void {
  const refs: SecretRef[] = listSecrets()
    .filter((record) => record.provider === provider && record.key === key)
    .map((record) => ({
      workspaceId: record.workspaceId,
      externalWorkspaceId: record.externalWorkspaceId,
      userId: record.userId
    }));

  for (const ref of refs) {
    deleteSecret(provider, key, ref);
  }
}

export function saveIntegrationConnectionForAllWorkspaces(input: {
  provider: string;
  credentialKind: IntegrationDefinition['credentialKind'];
  metadata?: Record<string, unknown>;
  status?: 'connected' | 'error';
  errorMessage?: string;
}): void {
  const store = getStore();
  for (const workspace of store.listWorkspaces()) {
    store.saveIntegrationConnection({
      workspaceId: workspace.id,
      provider: input.provider,
      credentialKind: input.credentialKind,
      metadata: input.metadata,
      status: input.status,
      errorMessage: input.errorMessage
    });
  }
}

export function deleteIntegrationConnectionForAllWorkspaces(provider: string): void {
  const store = getStore();
  for (const workspace of store.listWorkspaces()) {
    store.deleteIntegrationConnection(workspace.id, provider);
  }
}
