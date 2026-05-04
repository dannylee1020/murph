import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sendJson, serveStatic } from './http.js';
import { dispatchRoute, type Route } from './router.js';
import { formRoutes } from './routes/forms.js';
import { gatewayRoutes } from './routes/gateway.js';
import { discordRoutes } from './routes/discord.js';
import { integrationRoutes } from './routes/integrations.js';
import { slackRoutes } from './routes/slack.js';
import { systemRoutes } from './routes/system.js';
import { getGateway } from '#lib/server/runtime/gateway';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../..');
const staticRoot = path.resolve(repoRoot, 'dist/ui');
const port = Number(process.env.PORT ?? 5173);
const routes: Route[] = [...systemRoutes, ...gatewayRoutes, ...integrationRoutes, ...slackRoutes, ...discordRoutes, ...formRoutes];
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

gateway.ensureStarted();

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

server.listen(port, () => {
  console.log(`Murph server listening on http://localhost:${port}`);
});

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
  });
}
