import { channelRoutes } from '../server/routes/channels.js';
import { discordRoutes } from '../server/routes/discord.js';
import { formRoutes } from '../server/routes/forms.js';
import { gatewayRoutes } from '../server/routes/gateway.js';
import { integrationRoutes } from '../server/routes/integrations.js';
import { pluginRoutes } from '../server/routes/plugins.js';
import { slackRoutes } from '../server/routes/slack.js';
import { sourceIndexRoutes } from '../server/routes/source-index.js';
import { systemRoutes } from '../server/routes/system.js';
import type { Route } from '../server/router.js';

export function murphRoutes(): Route[] {
  return [
    ...systemRoutes,
    ...gatewayRoutes,
    ...channelRoutes,
    ...integrationRoutes,
    ...pluginRoutes,
    ...sourceIndexRoutes,
    ...slackRoutes,
    ...discordRoutes,
    ...formRoutes
  ];
}
