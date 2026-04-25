import type { IncomingMessage, ServerResponse } from 'node:http';

export type RouteParams = Record<string, string>;

export interface RequestContext {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  params: RouteParams;
}

export type Handler = (context: RequestContext) => void | Promise<void>;

export interface Route {
  method: string;
  pattern: RegExp;
  keys: string[];
  handler: Handler;
}

export function route(method: string, pattern: string, handler: Handler): Route {
  const keys: string[] = [];
  const escaped = pattern
    .split('/')
    .map((part) => {
      if (part.startsWith(':')) {
        keys.push(part.slice(1));
        return '([^/]+)';
      }
      return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    })
    .join('/');

  return {
    method,
    pattern: new RegExp(`^${escaped}$`),
    keys,
    handler
  };
}

export async function dispatchRoute(
  routes: Route[],
  context: Omit<RequestContext, 'params'>
): Promise<boolean> {
  const method = context.req.method ?? 'GET';

  for (const candidate of routes) {
    if (candidate.method !== method) {
      continue;
    }

    const match = candidate.pattern.exec(context.url.pathname);
    if (!match) {
      continue;
    }

    const params = Object.fromEntries(
      candidate.keys.map((key, index) => [key, decodeURIComponent(match[index + 1] ?? '')])
    );
    await candidate.handler({ ...context, params });
    return true;
  }

  return false;
}
