import { decryptString } from '#lib/server/util/crypto';
import { getRuntimeEnv } from '#lib/server/util/env';
import { getStore } from '#lib/server/persistence/store';
import { readEnvCredential } from './registry.js';

export interface ResolvedCredential {
  source: 'database' | 'env';
  value: string;
  metadata?: Record<string, unknown>;
}

export function maskCredential(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length <= 4) {
    return '****';
  }
  return `****${trimmed.slice(-4)}`;
}

export function resolveCredential(workspaceId: string | undefined, provider: string): ResolvedCredential | undefined {
  const store = getStore();
  const workspace = workspaceId ? store.getWorkspaceById(workspaceId) : store.getFirstWorkspace();
  const envValue = readEnvCredential(provider);

  if (workspace) {
    const stored = store.getIntegrationCredential(workspace.id, provider);
    if (stored?.status === 'connected') {
      const encryptionKey = getRuntimeEnv().encryptionKey;
      if (!encryptionKey) {
        throw new Error('MURPH_ENCRYPTION_KEY is required to read stored integration credentials');
      }

      return {
        source: 'database',
        value: decryptString(stored.credentialEncrypted, encryptionKey),
        metadata: stored.metadata
      };
    }
  }

  return envValue ? { source: 'env', value: envValue } : undefined;
}
