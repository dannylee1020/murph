import { existsSync } from 'node:fs';
import { getRuntimeEnv } from '#shared/server/util/env';
import { getStore } from '#shared/server/persistence/store';
import { getNotionStatus } from '#shared/server/context-sources/notion';
import { getSlackService } from '#shared/server/channels/slack/service';
import { getDiscordService } from '#shared/server/channels/discord/service';
import { getIngressHealth } from '#shared/server/channels/ingress-health';
import { MURPH_CONFIG_FILE, murphConfigExists, murphConfigPath, readMurphConfig } from '#shared/server/setup/config-file';
import { credentialsPath, listSecrets } from '#shared/server/credentials/local-store';

export type SetupCheckStatus = 'ok' | 'warning' | 'action_required' | 'error';

export interface SetupDoctorCheck {
  id: string;
  label: string;
  status: SetupCheckStatus;
  message: string;
  fix?: string;
}

export interface SetupDoctorPayload {
  ok: boolean;
  ready: boolean;
  checks: SetupDoctorCheck[];
  nextStep: 'core' | 'ai' | 'slack_config' | 'slack_oauth' | 'identity' | 'channels' | 'ready';
}

function check(id: string, label: string, status: SetupCheckStatus, message: string, fix?: string): SetupDoctorCheck {
  return { id, label, status, message, fix };
}

function configuredChannelTargetCount(setupDefaults: {
  channelScopeMode?: 'selected' | 'all_accessible';
  selectedChannels?: Array<{ id: string }>;
  workspaceChannels?: Array<{
    workspaceId: string;
    channelScopeMode: 'selected' | 'all_accessible';
    selectedChannels: Array<{ id: string }>;
  }>;
}): number {
  if (setupDefaults.workspaceChannels?.length) {
    return setupDefaults.workspaceChannels.filter((entry) => (
      entry.channelScopeMode === 'all_accessible' || entry.selectedChannels.length > 0
    )).length;
  }
  if (setupDefaults.channelScopeMode === 'all_accessible') return 1;
  return setupDefaults.selectedChannels?.length ? 1 : 0;
}

export function getSetupDoctor(): SetupDoctorPayload {
  const env = getRuntimeEnv();
  const store = getStore();
  const summary = store.getWorkspaceSummary();
  const setupDefaults = store.getAppSettings().setupDefaults ?? {};
  const configuredOwnerCount = Number(Boolean(setupDefaults?.ownerUserId)) + (setupDefaults?.workspaceOwners?.length ?? 0);
  const slack = getSlackService();
  const slackWorkspace = slack.getUsableWorkspace();
  const slackIngress = getIngressHealth('slack');
  const discordIngress = getIngressHealth('discord');
  const hasDiscordWorkspace = store.listWorkspaces().some((workspace) => workspace.provider === 'discord');
  const discordConfigured = getDiscordService().isConfigured();
  const slackReconnectRequired = !slackWorkspace && slack.hasUnreadableInstall();
  const hasCredentialsFile = existsSync(credentialsPath());
  const checks: SetupDoctorCheck[] = [];

  const hasConfigSource = murphConfigExists() || hasCredentialsFile || Boolean(env.openaiApiKey || env.anthropicApiKey);
  checks.push(
    hasConfigSource
      ? check('config_file', 'Configuration source', 'ok', murphConfigExists() ? `${murphConfigPath()} exists.` : hasCredentialsFile ? `${credentialsPath()} exists.` : 'process env is configured.')
      : check('config_file', 'Configuration source', 'action_required', `${MURPH_CONFIG_FILE} is missing.`, 'Run ./install.sh or murph setup core.')
  );

  checks.push(
    hasCredentialsFile || listSecrets().length > 0
      ? check('credentials_file', 'Runtime credentials', 'ok', `Credentials are stored at ${credentialsPath()}.`)
      : check('credentials_file', 'Runtime credentials', 'warning', 'No runtime credentials file exists yet.', 'Run murph setup to save credentials on this Murph host.')
  );

  checks.push(
    env.openaiApiKey || env.anthropicApiKey
      ? check('ai_provider', 'AI provider', 'ok', `${env.defaultProvider} is configured.`)
      : check('ai_provider', 'AI provider', 'action_required', 'Add an OpenAI or Anthropic key so Murph can draft replies.', 'Paste a provider key in setup.')
  );

  checks.push(
    env.slackEventsMode === 'socket'
      ? check('slack_events_mode', 'Slack event mode', 'ok', 'Slack is set to Socket Mode.')
      : check('slack_events_mode', 'Slack event mode', 'warning', 'Slack is using HTTP Events mode.', 'Use Socket Mode for local installs.')
  );

  checks.push(
    env.slackEventsMode === 'http' || env.slackAppToken
      ? check('slack_socket', 'Slack Socket Mode', 'ok', env.slackEventsMode === 'http' ? 'Socket Mode is disabled for HTTP mode.' : 'Slack app-level token is configured.')
      : check('slack_socket', 'Slack Socket Mode', 'action_required', 'Add a Slack app-level token with connections:write.', 'Create an app-level token in Slack and paste it as SLACK_APP_TOKEN.')
  );

  checks.push(
    env.slackClientId && env.slackClientSecret
      ? check('slack_oauth_config', 'Slack OAuth app', 'ok', 'Slack OAuth credentials are configured.')
      : check('slack_oauth_config', 'Slack OAuth app', 'action_required', 'Add Slack client ID and client secret before connecting the workspace.', 'Paste values from the Slack app Basic Information page.')
  );

  checks.push(
    slackWorkspace
      ? check('slack_installed', 'Slack workspace', 'ok', `${slackWorkspace.name} is connected.`)
      : slackReconnectRequired
        ? check('slack_installed', 'Slack workspace', 'action_required', 'Reconnect Slack. The saved Slack token is not available in runtime credentials.', 'Use the Connect Slack button again.')
      : check('slack_installed', 'Slack workspace', 'action_required', 'Connect a Slack workspace.', 'Use the Connect Slack button after Slack config is ready.')
  );

  checks.push(
    slackWorkspace && slack.getUserSearchToken(slackWorkspace)
      ? check('slack_user_search', 'Slack user search', 'ok', 'Slack search token is configured.')
      : check('slack_user_search', 'Slack user search', 'warning', 'Slack cross-channel search is not connected yet.', 'Reconnect Slack with search:read user scope.')
  );

  if (slackWorkspace && env.slackEventsMode === 'socket' && env.slackAppToken) {
    checks.push(
      slackIngress.connected
        ? check('slack_ingress', 'Slack event ingress', 'ok', 'Slack Socket Mode is connected.')
        : slackIngress.status === 'error'
          ? check('slack_ingress', 'Slack event ingress', 'action_required', slackIngress.lastError ?? 'Slack Socket Mode is not connected.', 'Check the Slack app-level token and restart Murph.')
          : check('slack_ingress', 'Slack event ingress', 'warning', 'Slack Socket Mode has not reported a connected state yet.', 'Restart Murph if this does not clear.')
    );
  }

  if (hasDiscordWorkspace) {
    checks.push(
      discordIngress.connected
        ? check('discord_ingress', 'Discord event ingress', 'ok', 'Discord Gateway is connected.')
        : discordIngress.status === 'error'
          ? check('discord_ingress', 'Discord event ingress', 'action_required', discordIngress.lastError ?? 'Discord Gateway is not connected.', discordIngress.lastCloseCode === 4014 ? 'Enable Message Content Intent in the Discord Developer Portal, then restart Murph.' : 'Check the Discord bot token and restart Murph.')
          : !discordConfigured || discordIngress.status === 'not_configured'
            ? check('discord_ingress', 'Discord event ingress', 'action_required', 'Discord Gateway is not configured.', 'Reconnect Discord or add a Discord bot token, then restart Murph.')
          : check('discord_ingress', 'Discord event ingress', 'warning', 'Discord Gateway has not reported a ready state yet.', 'Restart Murph if this does not clear.')
    );
  }

  checks.push(
    summary.userCount > 0 && configuredOwnerCount > 0
      ? check('identity', 'User identity', 'ok', `${configuredOwnerCount} owner identity${configuredOwnerCount === 1 ? '' : 'ies'} configured.`)
      : check('identity', 'User identity', 'action_required', 'Pick yourself so Murph knows who to watch for.')
  );

  if (env.distribution === 'personal') {
    const personalBotCount = store.listBotInstallations({ role: 'personal' })
      .filter((installation) => installation.status === 'active')
      .length;
    checks.push(
      personalBotCount > 0
        ? check('personal_bots', 'Personal bot DMs', 'ok', `${personalBotCount} personal bot connection${personalBotCount === 1 ? '' : 's'} configured.`)
        : check('personal_bots', 'Personal bot DMs', 'warning', 'Connect Slack or Discord personal bot DMs before using Murph Personal.', 'Run murph setup slack or murph setup discord.')
    );
  } else {
    const channelTargetCount = configuredChannelTargetCount(setupDefaults);
    const connectedChannelCount = Number(Boolean(slackWorkspace)) + Number(Boolean(hasDiscordWorkspace && discordConfigured));
    checks.push(
      channelTargetCount > 0
        ? check('channels', 'Watched channels', 'ok', `${channelTargetCount} workspace channel default${channelTargetCount === 1 ? '' : 's'} configured.`)
        : connectedChannelCount > 0
          ? check('channels', 'Bot connections', 'warning', 'A bot is connected, but watched-channel defaults are not configured yet.', 'Choose channels if this runtime should run channel handoffs.')
          : check('channels', 'Bot connections', 'action_required', 'Connect Slack or Discord, then choose channels or explicitly allow all accessible channels.')
    );
  }

  const notion = getNotionStatus();
  checks.push(
    notion.configured
      ? check('notion', 'Notion', 'ok', 'Notion is configured.')
      : check('notion', 'Notion', 'warning', 'Notion is not connected yet.', 'Add optional sources later from Admin.')
  );

  const channelsReady = env.distribution === 'personal' ||
    checks.find((entry) => entry.id === 'channels')?.status === 'ok';
  const nextStep =
    checks.find((entry) => entry.id === 'config_file')?.status !== 'ok' ||
    checks.find((entry) => entry.id === 'credentials_file')?.status === 'action_required'
      ? 'core'
      : checks.find((entry) => entry.id === 'ai_provider')?.status !== 'ok'
        ? 'ai'
        : checks.some((entry) => ['slack_events_mode', 'slack_socket', 'slack_oauth_config'].includes(entry.id) && entry.status !== 'ok')
          ? 'slack_config'
          : checks.find((entry) => entry.id === 'slack_installed')?.status !== 'ok'
            ? 'slack_oauth'
            : checks.find((entry) => entry.id === 'identity')?.status !== 'ok'
              ? 'identity'
              : !channelsReady
                ? 'channels'
                : 'ready';
  const ingressBlocking = checks.some((entry) => (
    ['slack_ingress', 'discord_ingress'].includes(entry.id) &&
    (entry.status === 'action_required' || entry.status === 'error')
  ));

  return {
    ok: true,
    ready: nextStep === 'ready' && !ingressBlocking,
    checks,
    nextStep
  };
}
