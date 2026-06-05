import { getChannelRegistry } from '#app/server/capabilities/channel-registry';
import { createDiscordChannelPlugin } from './discord/plugin.js';
import { createSlackChannelPlugin } from './slack/plugin.js';

let registered = false;

export function registerBuiltInChannelPlugins(): void {
  if (registered) {
    return;
  }
  const channels = getChannelRegistry();
  channels.registerPlugin(createSlackChannelPlugin(), { source: 'builtin' });
  channels.registerPlugin(createDiscordChannelPlugin(), { source: 'builtin' });
  registered = true;
}
