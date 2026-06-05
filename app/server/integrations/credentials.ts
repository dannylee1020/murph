import { readSecretRecord } from '#app/server/credentials/local-store';
import { readEnvCredential } from './registry.js';

export interface ResolvedCredential {
  source: 'credentials' | 'env';
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

export function resolveCredential(_workspaceId: string | undefined, provider: string): ResolvedCredential | undefined {
  const localRecord = readSecretRecord(provider, 'api_key') ??
    readSecretRecord(provider, 'oauth_bundle');
  if (localRecord) {
    return {
      source: 'credentials',
      value: localRecord.value,
      metadata: localRecord.metadata
    };
  }

  const envValue = readEnvCredential(provider);
  if (envValue) {
    return { source: 'env', value: envValue };
  }

  return undefined;
}
