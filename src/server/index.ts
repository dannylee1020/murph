import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sendJson, serveStatic } from './http.js';
import { dispatchRoute, type Route } from './router.js';
import { formRoutes } from './routes/forms.js';
import { gatewayRoutes } from './routes/gateway.js';
import { channelRoutes } from './routes/channels.js';
import { discordRoutes } from './routes/discord.js';
import { googleRoutes } from './routes/google.js';
import { integrationRoutes } from './routes/integrations.js';
import { pluginRoutes } from './routes/plugins.js';
import { slackRoutes } from './routes/slack.js';
import { systemRoutes } from './routes/system.js';
import { resolveListenPort, startServer } from './startup.js';
import { getGateway } from '#lib/server/runtime/gateway';
import { ensureRuntimeInitialized } from '#lib/server/runtime/bootstrap';
import { getMemoryIndexWorker } from '#lib/server/memory/index-worker';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../..');
const staticRoot = path.resolve(repoRoot, 'dist/ui');
let port: number;
try {
  port = resolveListenPort();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}

const routes: Route[] = [...systemRoutes, ...gatewayRoutes, ...channelRoutes, ...integrationRoutes, ...pluginRoutes, ...googleRoutes, ...slackRoutes, ...discordRoutes, ...formRoutes];
const gateway = getGateway();

function notFound(res: ServerResponse): void {
  sendJson(res, { ok: false, error: 'not_found' }, 404);
}

async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const host = req.headers.host ?? `localhost:${port}`;
  const url = new URL(req.url ?? '/', `http://${host}`);

  if (url.pathname.startsWith('/api/')) {
    if (await dispatchRoute(routes, { req, res, url })) {
      return;
    }

    notFound(res);
    return;
  }

  await serveStatic(req, res, url, staticRoot);
}

const server = createServer((req, res) => {
  void handleRequest(req, res).catch((error) => {
    console.error(error);
    if (!res.headersSent) {
      sendJson(res, { ok: false, error: error instanceof Error ? error.message : 'internal_error' }, 500);
    } else {
      res.end();
    }
  });
});

startServer(server, {
  port,
  onListening: () => {
    gateway.ensureStarted();
    getMemoryIndexWorker().ensureStarted();
    void ensureRuntimeInitialized().catch((error) => {
      console.warn('[server] runtime initialization failed:', error instanceof Error ? error.message : error);
    });
    console.log(`Murph server listening on http://localhost:${port}`);
  }
});

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
  });
}
