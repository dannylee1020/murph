import type { IncomingMessage } from 'node:http';
import { readJson, sendJson } from '../http.js';
import { route, type Route } from '../router.js';
import { DEFAULT_AGENT_MODEL } from '#lib/config';
import { getRuntimeEnv } from '#lib/server/util/env';
import { getNotionStatus } from '#lib/server/context-sources/notion';
import { ensureRuntimeInitialized } from '#lib/server/runtime/bootstrap';
import { refreshRuntimeState } from '#lib/server/runtime/refresh';
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
import { getIngressHealth } from '#lib/server/channels/ingress-health';
import { getChannelRegistry } from '#lib/server/capabilities/channel-registry';
import {
  providerLocksOwnerIdentity,
  requireMatchingSetupOwner,
  setupOwnerForWorkspace
} from '#lib/server/setup/owner-identity';
import type { SetupDefaults, Workspace } from '#lib/types';

function firstHeaderValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function publicAppUrl(req: IncomingMessage, url: URL): string {
  const forwardedHost = firstHeaderValue(req.headers['x-forwarded-host']);
  const host = forwardedHost ?? req.headers.host ?? url.host;
  const forwardedProto = firstHeaderValue(req.headers['x-forwarded-proto']);
  const proto = forwardedProto ?? (host.includes('localhost') || host.startsWith('127.') ? 'http' : 'https');
  return `${proto}://${host}`;
}

function discordDeveloperPortalOAuthUrl(applicationId: string): string {
  return `https://discord.com/developers/applications/${encodeURIComponent(applicationId)}/oauth2`;
}

function normalizeSetupDefaults(value: Partial<SetupDefaults>): SetupDefaults {
  const channelScopeMode = value.channelScopeMode === 'all_accessible' ? 'all_accessible' : 'selected';
  const selectedChannels = (value.selectedChannels ?? [])
    .map((channel) => ({
      id: channel.id?.trim(),
      displayName: channel.displayName?.trim() || channel.id?.trim()
    }))
    .filter((channel): channel is { id: string; displayName: string } => Boolean(channel.id && channel.displayName));
  const workspaceOwners = (value.workspaceOwners ?? [])
    .map((owner) => ({
      workspaceId: owner.workspaceId?.trim(),
      ownerUserId: owner.ownerUserId?.trim(),
      ownerDisplayName: owner.ownerDisplayName?.trim() || owner.ownerUserId?.trim()
    }))
    .filter((owner): owner is { workspaceId: string; ownerUserId: string; ownerDisplayName: string } => (
      Boolean(owner.workspaceId && owner.ownerUserId)
    ));
  const workspaceChannels = (value.workspaceChannels ?? [])
    .map((entry) => {
      const entryMode = entry.channelScopeMode === 'all_accessible' ? 'all_accessible' : 'selected';
      const entryChannels = (entry.selectedChannels ?? [])
        .map((channel) => ({
          id: channel.id?.trim(),
          displayName: channel.displayName?.trim() || channel.id?.trim()
        }))
        .filter((channel): channel is { id: string; displayName: string } => Boolean(channel.id && channel.displayName));
      return {
        workspaceId: entry.workspaceId?.trim(),
        channelScopeMode: entryMode,
        selectedChannels: entryMode === 'selected' ? entryChannels : []
      };
    })
    .filter((entry): entry is {
      workspaceId: string;
      channelScopeMode: 'selected' | 'all_accessible';
      selectedChannels: Array<{ id: string; displayName: string }>;
    } => Boolean(entry.workspaceId && (entry.channelScopeMode === 'all_accessible' || entry.selectedChannels.length > 0)));

  return {
    channelProvider: value.channelProvider?.trim() || undefined,
    workspaceId: value.workspaceId?.trim() || undefined,
    ownerUserId: value.ownerUserId?.trim() || undefined,
    ownerDisplayName: value.ownerDisplayName?.trim() || undefined,
    workspaceOwners,
    workspaceChannels,
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
  const defaults = resolveSetupDefaultsForWorkspace(workspace, effectiveSetupDefaults());
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

function resolveSetupDefaultsForWorkspace(workspace: Workspace | undefined, defaults: SetupDefaults): SetupDefaults {
  if (!workspace) {
    return defaults;
  }

  const workspaceOwner = defaults.workspaceOwners?.find((owner) => owner.workspaceId === workspace.id);
  const workspaceChannels = defaults.workspaceChannels?.find((channels) => channels.workspaceId === workspace.id);
  const channelDefaults = workspaceChannels
    ? {
        channelScopeMode: workspaceChannels.channelScopeMode,
        selectedChannels: workspaceChannels.selectedChannels
      }
    : {};
  if (workspaceOwner) {
    return {
      ...defaults,
      workspaceId: workspace.id,
      channelProvider: workspace.provider,
      ownerUserId: workspaceOwner.ownerUserId,
      ownerDisplayName: workspaceOwner.ownerDisplayName ?? workspaceOwner.ownerUserId,
      ...channelDefaults
    };
  }

  if (!defaults.ownerUserId) {
    return {
      ...defaults,
      workspaceId: workspace.id,
      channelProvider: workspace.provider,
      ...channelDefaults
    };
  }

  const workspaces = getStore().listWorkspaces();
  const defaultWorkspaceId = defaults.workspaceId;
  const legacyOwnerApplies = defaultWorkspaceId
    ? defaultWorkspaceId === workspace.id
    : workspaces.length <= 1;

  return legacyOwnerApplies
    ? {
        ...defaults,
        workspaceId: workspace.id,
        channelProvider: workspace.provider,
        ...channelDefaults
      }
    : {
        ...defaults,
        workspaceId: workspace.id,
        channelProvider: workspace.provider,
        ownerUserId: undefined,
        ownerDisplayName: undefined,
        ...channelDefaults
      };
}

function workspaceChannelsConfigured(defaults: SetupDefaults): boolean {
  if (defaults.workspaceChannels?.length) {
    return defaults.workspaceChannels.every((entry) => (
      entry.channelScopeMode === 'all_accessible' || entry.selectedChannels.length > 0
    ));
  }

  return defaults.channelScopeMode === 'all_accessible' || (defaults.selectedChannels?.length ?? 0) > 0;
}

function subscriptionScopeForWorkspace(
  workspace: Workspace,
  defaults: SetupDefaults
): { channelScopeMode: 'selected' | 'all_accessible'; channelScope: string[] } | undefined {
  const workspaceChannels = defaults.workspaceChannels?.find((entry) => entry.workspaceId === workspace.id);
  if (workspaceChannels) {
    return {
      channelScopeMode: workspaceChannels.channelScopeMode,
      channelScope: workspaceChannels.channelScopeMode === 'selected'
        ? workspaceChannels.selectedChannels.map((channel) => channel.id)
        : []
    };
  }

  if (defaults.workspaceId !== workspace.id) {
    return undefined;
  }

  const channelScopeMode = defaults.channelScopeMode ?? 'selected';
  return {
    channelScopeMode,
    channelScope: channelScopeMode === 'selected'
      ? (defaults.selectedChannels ?? []).map((channel) => channel.id)
      : []
  };
}

function syncSetupSubscriptions(defaults: SetupDefaults): void {
  const store = getStore();
  const owners = new Map<string, { ownerUserId: string; ownerDisplayName?: string }>();

  if (defaults.workspaceId && defaults.ownerUserId) {
    owners.set(defaults.workspaceId, {
      ownerUserId: defaults.ownerUserId,
      ownerDisplayName: defaults.ownerDisplayName
    });
  }
  for (const owner of defaults.workspaceOwners ?? []) {
    owners.set(owner.workspaceId, {
      ownerUserId: owner.ownerUserId,
      ownerDisplayName: owner.ownerDisplayName
    });
  }

  for (const [workspaceId, owner] of owners) {
    const ownerWorkspace = store.getWorkspaceById(workspaceId);
    if (!ownerWorkspace) continue;
    const scope = subscriptionScopeForWorkspace(ownerWorkspace, defaults);
    if (!scope || (scope.channelScopeMode === 'selected' && scope.channelScope.length === 0)) continue;

    const user = store.upsertUser({
      workspaceId: ownerWorkspace.id,
      externalUserId: owner.ownerUserId,
      displayName: owner.ownerDisplayName ?? owner.ownerUserId,
      timezone: defaults.timezone,
      workdayStartHour: defaults.workdayStartHour,
      workdayEndHour: defaults.workdayEndHour
    });
    store.ensureWorkspaceSubscriptionForUser(user, {
      provider: ownerWorkspace.provider,
      status: 'active',
      channelScopeMode: scope.channelScopeMode,
      channelScope: scope.channelScope
    });
  }
}

function sendOwnerIdentityError(
  res: Parameters<typeof sendJson>[0],
  check: Exclude<ReturnType<typeof requireMatchingSetupOwner>, { ok: true }>
): void {
  sendJson(res, {
    ok: false,
    error: check.error,
    owner: check.owner
      ? {
          workspaceId: check.owner.workspaceId,
          ownerUserId: check.owner.ownerUserId,
          ownerDisplayName: check.owner.ownerDisplayName
        }
      : undefined
  }, 400);
}

function validateOwnerUpdates(
  body: Partial<SetupDefaults> & { workspaceId?: string },
  workspace: Workspace,
  currentDefaults: SetupDefaults
): ReturnType<typeof requireMatchingSetupOwner> {
  const ownerUserId = body.ownerUserId?.trim();
  const ownerTouched = body.ownerUserId !== undefined ||
    body.ownerDisplayName !== undefined ||
    body.workspaceOwners !== undefined;

  if (!ownerTouched) {
    const owner = setupOwnerForWorkspace(workspace, currentDefaults);
    return {
      ok: true,
      owner: {
        workspaceId: workspace.id,
        ownerUserId: owner?.ownerUserId ?? '',
        ownerDisplayName: owner?.ownerDisplayName
      }
    };
  }

  if (body.ownerUserId !== undefined) {
    const check = requireMatchingSetupOwner(workspace, ownerUserId, currentDefaults);
    if (!check.ok) return check;
  }

  if (body.workspaceOwners !== undefined) {
    const requestedOwners = new Map(
      (body.workspaceOwners ?? [])
        .map((owner) => [owner.workspaceId?.trim(), owner.ownerUserId?.trim()] as const)
        .filter((entry): entry is [string, string] => Boolean(entry[0] && entry[1]))
    );

    for (const owner of body.workspaceOwners ?? []) {
      const ownerWorkspace = owner.workspaceId ? getStore().getWorkspaceById(owner.workspaceId) : undefined;
      if (!ownerWorkspace) continue;
      const check = requireMatchingSetupOwner(ownerWorkspace, owner.ownerUserId?.trim(), currentDefaults);
      if (!check.ok) return check;
    }

    for (const lockedWorkspace of getStore().listWorkspaces().filter((entry) => providerLocksOwnerIdentity(entry.provider))) {
      const existingOwner = setupOwnerForWorkspace(lockedWorkspace, currentDefaults);
      if (!existingOwner) continue;
      const requestedOwner = requestedOwners.get(lockedWorkspace.id);
      if (requestedOwner === undefined) {
        return { ok: false, error: 'owner_identity_required', owner: existingOwner };
      }
      if (requestedOwner !== existingOwner.ownerUserId) {
        return { ok: false, error: 'owner_identity_mismatch', owner: existingOwner };
      }
    }
  }

  return requireMatchingSetupOwner(workspace, ownerUserId, currentDefaults);
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
    const slackOwnerConfigured = Boolean(
      slackWorkspace && resolveSetupDefaultsForWorkspace(slackWorkspace, setupDefaults).ownerUserId
    );
    const discordConfigured = getDiscordService().isConfigured();
    const discordWorkspace = workspaces.find((workspace) => (
      workspace.provider === 'discord' &&
      discordConfigured
    ));
    const discordOwnerConfigured = Boolean(
      discordWorkspace && resolveSetupDefaultsForWorkspace(discordWorkspace, setupDefaults).ownerUserId
    );
    const connectedWorkspaceIds = new Set([slackWorkspace?.id, discordWorkspace?.id].filter(Boolean));
    const channelWorkspaces = workspaces
      .filter((workspace) => (
        connectedWorkspaceIds.has(workspace.id) ||
        (workspace.provider !== 'slack' && workspace.provider !== 'discord')
      ))
      .map((workspace) => ({
        id: workspace.id,
        provider: workspace.provider,
        externalWorkspaceId: workspace.externalWorkspaceId,
        name: workspace.name,
        botUserId: workspace.botUserId,
        installedAt: workspace.installedAt
      }));
    const config = readMurphConfig();
    const agentInheritsRuntime = process.env.MURPH_AGENT_PROVIDER === undefined &&
      process.env.MURPH_AGENT_MODEL === undefined &&
      !config.ai?.agent?.provider &&
      !config.ai?.agent?.model;

    sendJson(res, {
      ok: true,
      productMode: env.productMode,
      slack: {
        installed: Boolean(slackWorkspace),
        oauthConfigured: Boolean(env.slackClientId && env.slackClientSecret),
        signingSecretConfigured: Boolean(env.slackSigningSecret),
        eventsMode: env.slackEventsMode,
        socketConfigured: Boolean(env.slackAppToken),
        ingress: getIngressHealth('slack'),
        userSearchConfigured: Boolean(slackWorkspace && getSlackService().getUserSearchToken(slackWorkspace)),
        ownerConfigured: slackOwnerConfigured,
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
        botTokenConfigured: discordConfigured,
        clientIdConfigured: Boolean(env.discordClientId),
        clientSecretConfigured: Boolean(env.discordClientSecret),
        oauthConfigured: Boolean(env.discordClientId && env.discordClientSecret),
        ownerConfigured: discordOwnerConfigured,
        ingress: getIngressHealth('discord'),
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
      channelWorkspaces,
      notion: getNotionStatus(),
      userConfigured: summary.userCount > 0 && Boolean(
        setupDefaults?.ownerUserId || (setupDefaults?.workspaceOwners?.length ?? 0) > 0
      ),
      channelsConfigured: env.productMode === 'personal' ? channelWorkspaces.length > 0 : workspaceChannelsConfigured(setupDefaults)
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
    if (providerLocksOwnerIdentity(workspace.provider)) {
      sendJson(res, { ok: false, error: 'owner_identity_locked', members: [] }, 410);
      return;
    }
    sendJson(res, { ok: true, workspaceId: workspace.id, provider: workspace.provider, members: await getChannelRegistry().listMembers(workspace) });
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
    const ownerCheck = requireMatchingSetupOwner(workspace, userId, effectiveSetupDefaults());
    if (!ownerCheck.ok) {
      sendOwnerIdentityError(res, ownerCheck);
      return;
    }
    sendJson(res, { ok: true, workspaceId: workspace.id, provider: workspace.provider, member: await getChannelRegistry().getMember(workspace, userId) });
  }),
  route('GET', '/api/setup/channels', async ({ res, url }) => {
    await ensureRuntimeInitialized();
    const provider = url.searchParams.get('provider') ?? undefined;
    const workspace = getProviderWorkspace(provider, url.searchParams.get('workspaceId') ?? undefined);
    if (!workspace) {
      sendJson(res, { ok: false, error: 'workspace_required' }, 400);
      return;
    }
    sendJson(res, { ok: true, workspaceId: workspace.id, provider: workspace.provider, channels: await getChannelRegistry().listChannels(workspace) });
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
    sendJson(res, { ok: true, workspaceId: workspace.id, provider: workspace.provider, channel: await getChannelRegistry().getChannel(workspace, channelId) });
  }),
  route('PUT', '/api/setup/defaults', async ({ req, res }) => {
    await ensureRuntimeInitialized();
    const body = await readJson<Partial<SetupDefaults> & { workspaceId?: string }>(req);
    const workspace = getSetupWorkspace(body.workspaceId);

    if (!workspace) {
      sendJson(res, { ok: false, error: 'workspace_required' }, 400);
      return;
    }

    const currentDefaults = effectiveSetupDefaults();
    const ownerCheck = validateOwnerUpdates(body, workspace, currentDefaults);
    if (!ownerCheck.ok) {
      sendOwnerIdentityError(res, ownerCheck);
      return;
    }

    const defaults = normalizeSetupDefaults({
      ...currentDefaults,
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
    for (const owner of defaults.workspaceOwners ?? []) {
      const ownerWorkspace = getStore().getWorkspaceById(owner.workspaceId);
      if (!ownerWorkspace) continue;
      getStore().upsertUser({
        workspaceId: ownerWorkspace.id,
        externalUserId: owner.ownerUserId,
        displayName: owner.ownerDisplayName ?? owner.ownerUserId,
        timezone: defaults.timezone,
        workdayStartHour: defaults.workdayStartHour,
        workdayEndHour: defaults.workdayEndHour
      });
    }

    syncSetupSubscriptions(defaults);
    updateMurphSetupDefaults(defaults);
    const refresh = await refreshRuntimeState({
      reason: 'setup_defaults_updated',
      workspaceIds: [workspace.id],
      deferIfRunActive: true
    });
    sendJson(res, { ...setupDefaultsPayload(workspace), refresh });
  }),
  route('GET', '/api/setup/doctor', async ({ res }) => {
    await ensureRuntimeInitialized();
    sendJson(res, getSetupDoctor());
  }),
  route('POST', '/api/setup/discord/prepare', async ({ req, res, url }) => {
    const body = await readJson<{ botToken?: string; clientSecret?: string }>(req);
    const discord = getDiscordService();
    const botToken = body.botToken?.trim() || (() => {
      try {
        return discord.getBotToken();
      } catch {
        return undefined;
      }
    })();
    const clientSecret = body.clientSecret?.trim() || getRuntimeEnv().discordClientSecret;

    if (!botToken) {
      sendJson(res, { ok: false, error: 'Discord bot token is required.' }, 400);
      return;
    }
    if (!clientSecret) {
      sendJson(res, { ok: false, error: 'Discord client secret is required.' }, 400);
      return;
    }

    try {
      const bot = await discord.validateBotToken(botToken);
      updateSetupConfigValues({
        DISCORD_BOT_TOKEN: botToken,
        DISCORD_CLIENT_ID: bot.applicationId,
        DISCORD_CLIENT_SECRET: clientSecret
      });
      const configuration = await discord.configureApplication(botToken);
      const appUrl = publicAppUrl(req, url);
      const env = getRuntimeEnv();
      const redirectUri = env.discordRedirectUri ?? `${appUrl}/api/discord/oauth/callback`;
      const redirectUriRegistered = bot.applicationRedirectUris === undefined
        ? undefined
        : bot.applicationRedirectUris.includes(redirectUri);

      sendJson(res, {
        ok: true,
        botUserId: bot.botUserId,
        botName: bot.botName ?? bot.botUsername ?? bot.botUserId,
        applicationId: bot.applicationId,
        applicationName: bot.applicationName,
        redirectUri,
        developerPortalUrl: discordDeveloperPortalOAuthUrl(bot.applicationId),
        redirectUriRegistered,
        permissionsConfigured: configuration.permissionsConfigured,
        intentsConfigured: configuration.intentsConfigured,
        configurationError: configuration.error,
        installUrl: '/api/discord/install?source=setup'
      });
    } catch (error) {
      sendJson(res, {
        ok: false,
        error: error instanceof Error ? error.message : 'Discord setup preparation failed'
      }, 400);
    }
  }),
  route('POST', '/api/setup/config', async ({ req, res }) => {
    const body = await readJson<Record<string, string | undefined>>(req);

    try {
      const result = updateSetupConfigValues(body);
      const refresh = await refreshRuntimeState({
        reason: 'setup_config_updated',
        deferIfRunActive: true
      });
      sendJson(res, { ok: true, ...result, doctor: getSetupDoctor(), refresh });
    } catch (error) {
      sendJson(res, { ok: false, error: error instanceof Error ? error.message : 'setup_config_update_failed' }, 400);
    }
  })
];
