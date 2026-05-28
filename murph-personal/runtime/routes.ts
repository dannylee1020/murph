import { channelRoutes } from '../../shared/server/routes/channels.js';
import { discordRoutes } from '../../shared/server/routes/discord.js';
import { formRoutes } from '../../shared/server/routes/forms.js';
import { gatewayRoutes } from '../../shared/server/routes/gateway.js';
import { googleRoutes } from '../../shared/server/routes/google.js';
import { integrationRoutes } from '../../shared/server/routes/integrations.js';
import { pluginRoutes } from '../../shared/server/routes/plugins.js';
import { slackRoutes } from '../../shared/server/routes/slack.js';
import { systemRoutes } from '../../shared/server/routes/system.js';
import type { Route } from '../../shared/server/router.js';

function withoutPaths(routes: Route[], isExcluded: (path: string) => boolean): Route[] {
  return routes.filter((route) => !isExcluded(route.path));
}

const subscriberGatewayRoutes = new Set([
  '/api/gateway/subscriptions',
  '/api/gateway/subscriptions/:userId',
  '/api/gateway/subscriptions/:userId/dashboard-link'
]);

export function personalRoutes(): Route[] {
  return [
    ...systemRoutes,
    ...withoutPaths(gatewayRoutes, (path) => subscriberGatewayRoutes.has(path)),
    ...channelRoutes,
    ...integrationRoutes,
    ...pluginRoutes,
    ...googleRoutes,
    ...slackRoutes,
    ...discordRoutes,
    ...formRoutes
  ];
}
