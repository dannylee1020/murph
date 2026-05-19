import { sendJson } from '../http.js';
import { route, type Route } from '../router.js';
import { DEFAULT_AGENT_MODEL } from '#lib/config';
import { getRuntimeEnv } from '#lib/server/util/env';
import { getNotionStatus } from '#lib/server/context-sources/notion';
import { ensureRuntimeInitialized } from '#lib/server/runtime/bootstrap';
import { getStore } from '#lib/server/persistence/store';
import { getSetupDoctor } from '#lib/server/setup/doctor';
import { updateSetupConfigValues } from '#lib/server/setup/config-values';
import {
  MURPH_CONFIG_FILE,
  SETUP_CONFIG_KEYS,
  murphConfigPath,
  murphConfigExists,
  readMurphConfig,
  updateMurphSetupDefaults
} from '#lib/server/setup/config-file';
import { getSlackService } from '#lib/server/channels/slack/service';
import { getDiscordService } from '#lib/server/channels/discord/service';
import { readSecret } from '#lib/server/credentials/local-store';
import { readJson } from '../http.js';
import type { SetupDefaults, Workspace } from '#lib/types';

function normalizeSetupDefaults(value: Partial<SetupDefaults>): SetupDefaults {
  const channelScopeMode = value.channelScopeMode === 'all_accessible' ? 'all_accessible' : 'selected';
  const selectedChannels = (value.selectedChannels ?? [])
    .map((channel) => ({
      id: channel.id?.trim(),
      displayName: channel.displayName?.trim() || channel.id?.trim()
    }))
    .filter((channel): channel is { id: string; displayName: string } => Boolean(channel.id && channel.displayName));

  return {
    channelProvider: value.channelProvider?.trim() || undefined,
    workspaceId: value.workspaceId?.trim() || undefined,
    ownerUserId: value.ownerUserId?.trim() || undefined,
    ownerDisplayName: value.ownerDisplayName?.trim() || undefined,
    channelScopeMode,
    selectedChannels,
    timezone: value.timezone?.trim() || undefined,
    workdayStartHour: Number.isFinite(value.workdayStartHour) ? value.workdayStartHour : undefined,
    workdayEndHour: Number.isFinite(value.workdayEndHour) ? value.workdayEndHour : undefined
  };
}

function getSetupWorkspace(workspaceId?: string): Workspace | undefined {
  const store = getStore();
  const defaults = effectiveSetupDefaults();
  const resolvedWorkspaceId = workspaceId ?? defaults.workspaceId;
  if (resolvedWorkspaceId) {
    return store.getWorkspaceById(resolvedWorkspaceId);
  }
  if (defaults.channelProvider) {
    return store.listWorkspaces().find((workspace) => workspace.provider === defaults.channelProvider);
  }
  return getSlackService().getUsableWorkspace() ?? store.getFirstWorkspace();
}

function setupDefaultsPayload(workspace?: Workspace) {
  const defaults = effectiveSetupDefaults();
  const user = workspace && defaults.ownerUserId
    ? getStore().getUser(workspace.id, defaults.ownerUserId)
    : undefined;

  return {
    ok: true,
    workspaceId: workspace?.id,
    defaults,
    user
  };
}

function getProviderWorkspace(provider?: string, workspaceId?: string): Workspace | undefined {
  const store = getStore();
  if (workspaceId) {
    const workspace = store.getWorkspaceById(workspaceId);
    return provider && workspace?.provider !== provider ? undefined : workspace;
  }
  const defaults = effectiveSetupDefaults();
  const targetProvider = provider ?? defaults.channelProvider;
  if (targetProvider) {
    if (targetProvider === 'slack') {
      return getSlackService().getUsableWorkspace() ??
        store.listWorkspaces().find((workspace) => workspace.provider === 'slack');
    }
    return store.listWorkspaces().find((workspace) => workspace.provider === targetProvider);
  }
  return getSetupWorkspace();
}

function effectiveSetupDefaults(): SetupDefaults {
  return normalizeSetupDefaults({
    ...(getStore().getAppSettings().setupDefaults ?? {}),
    ...(readMurphConfig().setup ?? {})
  });
}

function envOverrides(): string[] {
  return [...SETUP_CONFIG_KEYS].filter((key) => process.env[key] !== undefined).sort();
}

export const systemRoutes: Route[] = [
  route('GET', '/api/health', ({ res }) => {
    const summary = getStore().getWorkspaceSummary();
    return sendJson(res, {
      ok: true,
      service: 'murph',
      timestamp: new Date().toISOString(),
      installed: Boolean(summary.workspace),
      queued: summary.queuedCount,
      reminders: summary.reminderCount,
      activeSessions: summary.activeSessionCount,
      controlPlane: {
        http: '/api/gateway/*',
        events: '/api/gateway/events'
      }
    });
  }),
  route('GET', '/api/setup/status', async ({ res }) => {
    await ensureRuntimeInitialized();
    const env = getRuntimeEnv();
    const summary = getStore().getWorkspaceSummary();
    const setupDefaults = effectiveSetupDefaults();
    const workspaces = getStore().listWorkspaces();
    const slackWorkspace = getSlackService().getUsableWorkspace();
    const discordWorkspace = workspaces.find((workspace) => (
      workspace.provider === 'discord' &&
      (Boolean(env.discordBotToken) || Boolean(readSecret('discord', 'bot_token', {
        workspaceId: workspace.id,
        externalWorkspaceId: workspace.externalWorkspaceId
      })))
    ));
    const config = readMurphConfig();
    const agentInheritsRuntime = process.env.MURPH_AGENT_PROVIDER === undefined &&
      process.env.MURPH_AGENT_MODEL === undefined &&
      !config.ai?.agent?.provider &&
      !config.ai?.agent?.model;

    sendJson(res, {
      ok: true,
      slack: {
        installed: Boolean(slackWorkspace),
        oauthConfigured: Boolean(env.slackClientId && env.slackClientSecret),
        signingSecretConfigured: Boolean(env.slackSigningSecret),
        eventsMode: env.slackEventsMode,
        socketConfigured: Boolean(env.slackAppToken),
        userSearchConfigured: Boolean(slackWorkspace && getSlackService().getUserSearchToken(slackWorkspace)),
        workspace: slackWorkspace
          ? {
              id: slackWorkspace.id,
              externalWorkspaceId: slackWorkspace.externalWorkspaceId,
              name: slackWorkspace.name
            }
          : undefined
      },
      discord: {
        installed: Boolean(discordWorkspace),
        botTokenConfigured: Boolean(env.discordBotToken || readSecret('discord', 'bot_token')),
        clientIdConfigured: Boolean(env.discordClientId),
        workspace: discordWorkspace
          ? {
              id: discordWorkspace.id,
              externalWorkspaceId: discordWorkspace.externalWorkspaceId,
              name: discordWorkspace.name
            }
          : undefined
      },
      provider: {
        configured: Boolean(env.openaiApiKey || env.anthropicApiKey),
        defaultProvider: env.defaultProvider,
        defaultModel: env.defaultModel,
        agentProvider: env.agentProvider,
        agentModel: env.agentModel,
        agentInheritsRuntime,
        defaultAgentModels: DEFAULT_AGENT_MODEL
      },
      config: {
        file: MURPH_CONFIG_FILE,
        path: murphConfigPath(),
        configured: murphConfigExists(),
        envOverrides: envOverrides()
      },
      notion: getNotionStatus(),
      userConfigured: summary.userCount > 0 && Boolean(setupDefaults?.ownerUserId),
      channelsConfigured: setupDefaults?.channelScopeMode === 'all_accessible' ||
        (setupDefaults?.selectedChannels?.length ?? 0) > 0
    });
  }),
  route('GET', '/api/setup/defaults', async ({ res, url }) => {
    await ensureRuntimeInitialized();
    sendJson(res, setupDefaultsPayload(getSetupWorkspace(url.searchParams.get('workspaceId') ?? undefined)));
  }),
  route('GET', '/api/setup/members', async ({ res, url }) => {
    await ensureRuntimeInitialized();
    const provider = url.searchParams.get('provider') ?? undefined;
    const workspace = getProviderWorkspace(provider, url.searchParams.get('workspaceId') ?? undefined);
    if (!workspace) {
      sendJson(res, { ok: false, error: 'workspace_required' }, 400);
      return;
    }
    if (workspace.provider === 'slack') {
      sendJson(res, { ok: true, workspaceId: workspace.id, provider: workspace.provider, members: await getSlackService().listMembers(workspace) });
      return;
    }
    if (workspace.provider === 'discord') {
      sendJson(res, { ok: true, workspaceId: workspace.id, provider: workspace.provider, members: await getDiscordService().listMembers(workspace) });
      return;
    }
    sendJson(res, { ok: false, error: `unsupported_provider:${workspace.provider}` }, 400);
  }),
  route('GET', '/api/setup/member', async ({ res, url }) => {
    await ensureRuntimeInitialized();
    const provider = url.searchParams.get('provider') ?? undefined;
    const workspace = getProviderWorkspace(provider, url.searchParams.get('workspaceId') ?? undefined);
    const userId = url.searchParams.get('userId')?.trim();
    if (!workspace) {
      sendJson(res, { ok: false, error: 'workspace_required' }, 400);
      return;
    }
    if (!userId) {
      sendJson(res, { ok: false, error: 'user_id_required' }, 400);
      return;
    }
    if (workspace.provider === 'slack') {
      sendJson(res, { ok: true, workspaceId: workspace.id, provider: workspace.provider, member: await getSlackService().getMember(workspace, userId) });
      return;
    }
    if (workspace.provider === 'discord') {
      sendJson(res, { ok: true, workspaceId: workspace.id, provider: workspace.provider, member: await getDiscordService().getMember(workspace, userId) });
      return;
    }
    sendJson(res, { ok: false, error: `unsupported_provider:${workspace.provider}` }, 400);
  }),
  route('GET', '/api/setup/channels', async ({ res, url }) => {
    await ensureRuntimeInitialized();
    const provider = url.searchParams.get('provider') ?? undefined;
    const workspace = getProviderWorkspace(provider, url.searchParams.get('workspaceId') ?? undefined);
    if (!workspace) {
      sendJson(res, { ok: false, error: 'workspace_required' }, 400);
      return;
    }
    if (workspace.provider === 'slack') {
      sendJson(res, { ok: true, workspaceId: workspace.id, provider: workspace.provider, channels: await getSlackService().listChannels(workspace) });
      return;
    }
    if (workspace.provider === 'discord') {
      sendJson(res, { ok: true, workspaceId: workspace.id, provider: workspace.provider, channels: await getDiscordService().listChannels(workspace) });
      return;
    }
    sendJson(res, { ok: false, error: `unsupported_provider:${workspace.provider}` }, 400);
  }),
  route('GET', '/api/setup/channel', async ({ res, url }) => {
    await ensureRuntimeInitialized();
    const provider = url.searchParams.get('provider') ?? undefined;
    const workspace = getProviderWorkspace(provider, url.searchParams.get('workspaceId') ?? undefined);
    const channelId = url.searchParams.get('channelId')?.trim();
    if (!workspace) {
      sendJson(res, { ok: false, error: 'workspace_required' }, 400);
      return;
    }
    if (!channelId) {
      sendJson(res, { ok: false, error: 'channel_id_required' }, 400);
      return;
    }
    if (workspace.provider === 'slack') {
      const channel = await getSlackService().getChannelInfo(workspace, channelId);
      sendJson(res, {
        ok: true,
        workspaceId: workspace.id,
        provider: workspace.provider,
        channel: {
          id: channel.id,
          displayName: channel.name ? `#${channel.name}` : channel.id,
          isPrivate: channel.isPrivate,
          isMember: channel.isMember
        }
      });
      return;
    }
    if (workspace.provider === 'discord') {
      sendJson(res, { ok: true, workspaceId: workspace.id, provider: workspace.provider, channel: await getDiscordService().getChannel(workspace, channelId) });
      return;
    }
    sendJson(res, { ok: false, error: `unsupported_provider:${workspace.provider}` }, 400);
  }),
  route('PUT', '/api/setup/defaults', async ({ req, res }) => {
    await ensureRuntimeInitialized();
    const body = await readJson<Partial<SetupDefaults> & { workspaceId?: string }>(req);
    const workspace = getSetupWorkspace(body.workspaceId);

    if (!workspace) {
      sendJson(res, { ok: false, error: 'workspace_required' }, 400);
      return;
    }

    const defaults = normalizeSetupDefaults({
      ...effectiveSetupDefaults(),
      ...body
    });

    if (defaults.ownerUserId) {
      getStore().upsertUser({
        workspaceId: workspace.id,
        externalUserId: defaults.ownerUserId,
        displayName: defaults.ownerDisplayName ?? defaults.ownerUserId,
        timezone: defaults.timezone,
        workdayStartHour: defaults.workdayStartHour,
        workdayEndHour: defaults.workdayEndHour
      });
    }

    updateMurphSetupDefaults(defaults);
    sendJson(res, setupDefaultsPayload(workspace));
  }),
  route('GET', '/api/setup/doctor', async ({ res }) => {
    await ensureRuntimeInitialized();
    sendJson(res, getSetupDoctor());
  }),
  route('POST', '/api/setup/config', async ({ req, res }) => {
    const body = await readJson<Record<string, string | undefined>>(req);

    try {
      const result = updateSetupConfigValues(body);
      sendJson(res, { ok: true, ...result, doctor: getSetupDoctor() });
    } catch (error) {
      sendJson(res, { ok: false, error: error instanceof Error ? error.message : 'setup_config_update_failed' }, 400);
    }
  })
];
