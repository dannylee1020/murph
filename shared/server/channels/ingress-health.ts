import type { ChannelProvider } from '#shared/types';

export type IngressStatus = 'not_configured' | 'idle' | 'starting' | 'connected' | 'error';

export interface IngressHealth {
  provider: ChannelProvider;
  configured: boolean;
  started: boolean;
  connected: boolean;
  status: IngressStatus;
  lastStartedAt?: string;
  lastConnectedAt?: string;
  lastEventAt?: string;
  lastIgnoredAt?: string;
  lastIgnoredReason?: string;
  lastErrorAt?: string;
  lastError?: string;
  lastCloseCode?: number;
  lastCloseReason?: string;
}

const health = new Map<ChannelProvider, IngressHealth>();

function empty(provider: ChannelProvider): IngressHealth {
  return {
    provider,
    configured: false,
    started: false,
    connected: false,
    status: 'idle'
  };
}

function now(): string {
  return new Date().toISOString();
}

export function getIngressHealth(provider: ChannelProvider): IngressHealth {
  return { ...(health.get(provider) ?? empty(provider)) };
}

export function listIngressHealth(): IngressHealth[] {
  return [...health.values()].map((entry) => ({ ...entry }));
}

export function updateIngressHealth(
  provider: ChannelProvider,
  patch: Partial<Omit<IngressHealth, 'provider'>>
): IngressHealth {
  const next: IngressHealth = {
    ...(health.get(provider) ?? empty(provider)),
    ...patch,
    provider
  };
  health.set(provider, next);
  return { ...next };
}

export function markIngressConfigured(provider: ChannelProvider, configured: boolean): void {
  updateIngressHealth(provider, {
    configured,
    status: configured ? 'idle' : 'not_configured',
    started: configured ? getIngressHealth(provider).started : false,
    connected: configured ? getIngressHealth(provider).connected : false
  });
}

export function markIngressStarting(provider: ChannelProvider): void {
  updateIngressHealth(provider, {
    configured: true,
    started: true,
    connected: false,
    status: 'starting',
    lastStartedAt: now()
  });
}

export function markIngressConnected(provider: ChannelProvider): void {
  updateIngressHealth(provider, {
    configured: true,
    started: true,
    connected: true,
    status: 'connected',
    lastConnectedAt: now(),
    lastError: undefined,
    lastErrorAt: undefined,
    lastCloseCode: undefined,
    lastCloseReason: undefined
  });
}

export function markIngressEvent(provider: ChannelProvider): void {
  updateIngressHealth(provider, {
    configured: true,
    started: true,
    lastEventAt: now()
  });
}

export function markIngressIgnored(provider: ChannelProvider, reason: string): void {
  updateIngressHealth(provider, {
    configured: true,
    started: true,
    lastIgnoredAt: now(),
    lastIgnoredReason: reason
  });
}

export function markIngressError(provider: ChannelProvider, error: unknown): void {
  updateIngressHealth(provider, {
    configured: true,
    started: false,
    connected: false,
    status: 'error',
    lastErrorAt: now(),
    lastError: error instanceof Error ? error.message : String(error)
  });
}

export function markIngressClosed(provider: ChannelProvider, code?: number, reason?: string): void {
  updateIngressHealth(provider, {
    started: false,
    connected: false,
    status: code && code !== 1000 ? 'error' : 'idle',
    lastCloseCode: code,
    lastCloseReason: reason || undefined,
    ...(code && code !== 1000
      ? {
          lastErrorAt: now(),
          lastError: reason ? `Gateway closed with ${code}: ${reason}` : `Gateway closed with ${code}`
        }
      : {})
  });
}
