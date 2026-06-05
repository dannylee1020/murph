import { channelRoutes } from '../../shared/server/routes/channels.js';
import { discordRoutes } from '../../shared/server/routes/discord.js';
import { formRoutes } from '../../shared/server/routes/forms.js';
import { gatewayRoutes } from '../../shared/server/routes/gateway.js';
import { integrationRoutes } from '../../shared/server/routes/integrations.js';
import { pluginRoutes } from '../../shared/server/routes/plugins.js';
import { slackRoutes } from '../../shared/server/routes/slack.js';
import { sourceIndexRoutes } from '../../shared/server/routes/source-index.js';
import { systemRoutes } from '../../shared/server/routes/system.js';
import type { Route } from '../../shared/server/router.js';

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
