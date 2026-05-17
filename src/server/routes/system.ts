import { sendJson } from '../http.js';
import { route, type Route } from '../router.js';
import { DEFAULT_AGENT_MODEL } from '#lib/config';
import { getRuntimeEnv } from '#lib/server/util/env';
import { getNotionStatus } from '#lib/server/context-sources/notion';
import { ensureRuntimeInitialized } from '#lib/server/runtime/bootstrap';
import { getStore } from '#lib/server/persistence/store';
import { getSetupDoctor } from '#lib/server/setup/doctor';
import { updateSetupEnv } from '#lib/server/setup/env-file';
import {
  MURPH_CONFIG_FILE,
  SETUP_CONFIG_KEYS,
  murphConfigExists,
  readMurphConfig,
  updateMurphSetupDefaults
} from '#lib/server/setup/config-file';
import { getSlackSocketModeClient } from '#lib/server/channels/slack/socket-client';
import { getSlackService } from '#lib/server/channels/slack/service';
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
  return workspaceId
    ? store.getWorkspaceById(workspaceId)
    : getSlackService().getUsableWorkspace() ?? store.getFirstWorkspace();
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
    const discordWorkspace = workspaces.find((workspace) => workspace.provider === 'discord' && workspace.botTokenEncrypted);
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
        socketConfigured: Boolean(env.slackAppToken)
      },
      discord: {
        installed: Boolean(discordWorkspace),
        oauthConfigured: Boolean(env.discordClientId && env.discordClientSecret && env.discordRedirectUri),
        botTokenConfigured: Boolean(env.discordBotToken)
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
  route('POST', '/api/setup/env', async ({ req, res }) => {
    const body = await readJson<Record<string, string | undefined>>(req);

    try {
      const result = updateSetupEnv(body);
      if (result.updated.some((key) => ['SLACK_EVENTS_MODE', 'SLACK_APP_TOKEN'].includes(key))) {
        getSlackSocketModeClient().ensureStarted();
      }
      sendJson(res, { ok: true, ...result, doctor: getSetupDoctor() });
    } catch (error) {
      sendJson(res, { ok: false, error: error instanceof Error ? error.message : 'setup_env_update_failed' }, 400);
    }
  })
];
