import { sendJson } from '../http.js';
import { route, type Route } from '../router.js';
import { getRuntimeEnv } from '#lib/server/util/env';
import { getNotionStatus } from '#lib/server/context-sources/notion';
import { ensureRuntimeInitialized } from '#lib/server/runtime/bootstrap';
import { getStore } from '#lib/server/persistence/store';
import { getSetupDoctor } from '#lib/server/setup/doctor';
import { updateSetupEnv } from '#lib/server/setup/env-file';
import { getSlackSocketModeClient } from '#lib/server/channels/slack/socket-client';
import { getSlackService } from '#lib/server/channels/slack/service';
import { readJson } from '../http.js';

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
    const workspaces = getStore().listWorkspaces();
    const slackWorkspace = getSlackService().getUsableWorkspace();
    const discordWorkspace = workspaces.find((workspace) => workspace.provider === 'discord' && workspace.botTokenEncrypted);

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
        defaultProvider: env.defaultProvider
      },
      notion: getNotionStatus(),
      userConfigured: summary.userCount > 0
    });
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
