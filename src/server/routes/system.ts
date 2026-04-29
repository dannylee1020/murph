import { sendJson } from '../http.js';
import { route, type Route } from '../router.js';
import { getRuntimeEnv } from '#lib/server/util/env';
import { getNotionStatus } from '#lib/server/context-sources/notion';
import { ensureRuntimeInitialized } from '#lib/server/runtime/bootstrap';
import { getStore } from '#lib/server/persistence/store';

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

    sendJson(res, {
      ok: true,
      slack: {
        installed: Boolean(summary.workspace),
        oauthConfigured: Boolean(env.slackClientId && env.slackClientSecret),
        signingSecretConfigured: Boolean(env.slackSigningSecret)
      },
      discord: {
        installed: Boolean(summary.workspace && summary.workspace.provider === 'discord'),
        oauthConfigured: Boolean(env.discordClientId && env.discordClientSecret && env.discordRedirectUri),
        botTokenConfigured: Boolean(env.discordBotToken)
      },
      provider: {
        configured: Boolean(env.openaiApiKey || env.anthropicApiKey),
        defaultProvider: env.defaultProvider
      },
      notion: getNotionStatus()
    });
  })
];
