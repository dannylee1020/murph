import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sendJson, serveStatic } from './http.js';
import { dispatchRoute, type Route } from './router.js';
import { resolveListenPort, startServer } from './startup.js';
import { getGateway } from '#shared/server/runtime/gateway';
import { ensureRuntimeInitialized } from '#shared/server/runtime/bootstrap';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = process.env.MURPH_APP_DIR || path.resolve(here, '../../..');

function staticRootFor(): string {
  return path.resolve(repoRoot, 'dist', 'murph', 'ui');
}

export interface MurphServerOptions {
  routes: Route[];
  label?: string;
}

function notFound(res: ServerResponse): void {
  sendJson(res, { ok: false, error: 'not_found' }, 404);
}

export function createMurphHttpServer(options: MurphServerOptions & { port: number }): Server {
  async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const host = req.headers.host ?? `localhost:${options.port}`;
    const url = new URL(req.url ?? '/', `http://${host}`);

    if (url.pathname.startsWith('/api/')) {
      if (await dispatchRoute(options.routes, { req, res, url })) {
        return;
      }

      notFound(res);
      return;
    }

    await serveStatic(req, res, url, staticRootFor());
  }

  return createServer((req, res) => {
    void handleRequest(req, res).catch((error) => {
      console.error(error);
      if (!res.headersSent) {
        sendJson(res, { ok: false, error: error instanceof Error ? error.message : 'internal_error' }, 500);
      } else {
        res.end();
      }
    });
  });
}

export function startMurphServer(options: MurphServerOptions): void {
  process.env.MURPH_DISTRIBUTION = 'team';

  let port: number;
  try {
    port = resolveListenPort();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }

  const gateway = getGateway();
  const server = createMurphHttpServer({ ...options, port });

  startServer(server, {
    port,
    onListening: () => {
      gateway.ensureStarted();
      void ensureRuntimeInitialized().catch((error) => {
        console.warn('[server] runtime initialization failed:', error instanceof Error ? error.message : error);
      });
      console.log(`${options.label ?? 'Murph'} server listening on http://localhost:${port}`);
    }
  });

  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.on(signal, () => {
      server.close(() => process.exit(0));
    });
  }
}
