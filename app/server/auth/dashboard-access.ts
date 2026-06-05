import type { IncomingMessage } from 'node:http';
import { readMurphConfig } from '#app/server/setup/config-file';

export function resolvePublicAppUrl(req?: IncomingMessage, url?: URL): string {
  const hostHeader = req
    ? Array.isArray(req.headers['x-forwarded-host'])
      ? req.headers['x-forwarded-host'][0]
      : req.headers['x-forwarded-host'] ?? req.headers.host
    : undefined;
  const host = hostHeader ?? url?.host;
  const protoHeader = req
    ? Array.isArray(req.headers['x-forwarded-proto'])
      ? req.headers['x-forwarded-proto'][0]
      : req.headers['x-forwarded-proto']
    : undefined;
  const configured = readMurphConfig().app?.url ?? process.env.MURPH_APP_URL;
  if (!host && configured) {
    return configured.replace(/\/+$/, '');
  }

  const resolvedHost = host ?? `localhost:${process.env.PORT ?? process.env.MURPH_PORT ?? '5173'}`;
  const proto = protoHeader ?? (resolvedHost.includes('localhost') || resolvedHost.startsWith('127.') ? 'http' : 'https');
  return `${proto}://${resolvedHost}`.replace(/\/+$/, '');
}
