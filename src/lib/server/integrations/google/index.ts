import { getGmailService, toArtifact as gmailToArtifact } from '#lib/server/context-sources/gmail';
import { getGoogleCalendarService, toArtifact as calendarToArtifact } from '#lib/server/context-sources/google-calendar';
import { getStore } from '#lib/server/persistence/store';
import { getRuntimeEnv } from '#lib/server/util/env';
import { findGoogleOAuthRecord, getValidGoogleAccessToken } from '../google-oauth.js';
import type { IntegrationAdapter } from '../adapter.js';
import { compactCalendarEvents, queryFromThread, workdayWindowForDate } from '../shared.js';

function googleConfigured(workspaceId?: string): boolean {
  try {
    return Boolean(findGoogleOAuthRecord(workspaceId) || getRuntimeEnv().googleAccessToken);
  } catch {
    return false;
  }
}

export function createGoogleAdapter(): IntegrationAdapter {
  const gmail = getGmailService();
  const calendar = getGoogleCalendarService();
  return {
    id: 'google',
    name: 'Google',
    description: 'Gmail threads and Google Calendar events.',
    credential: {
      authType: 'oauth',
      credentialKind: 'oauth_bundle',
      envKey: 'GOOGLE_ACCESS_TOKEN',
      credentialLabel: 'Google account',
      installPath: '/api/google/install'
    },
    isConfigured: googleConfigured,
    contextSources: [
      {
        name: 'gmail.thread_search',
        description: 'Search Gmail threads by the current thread text.',
        optional: true,
        knowledgeDomains: ['email', 'customer'],
        async retrieve(input) {
          const token = await getValidGoogleAccessToken(input.workspace.id);
          const results = await gmail.search(token, queryFromThread(input), 3);
          return results.results.map((result) => gmailToArtifact(result));
        }
      },
      {
        name: 'calendar.upcoming_events',
        description: 'Load the next few upcoming Google Calendar events.',
        optional: true,
        knowledgeDomains: ['calendar', 'coordination'],
        async retrieve(input) {
          const token = await getValidGoogleAccessToken(input.workspace.id);
          const results = await calendar.upcomingEvents(token, 5);
          return results.events.map((event) => calendarToArtifact(event));
        }
      }
    ],
    tools: [
      {
        name: 'gmail.search',
        description: 'Search Gmail threads by query text.',
        sideEffectClass: 'read',
        retrievalEligible: true,
        retrieval: { profile: 'email_thread' },
        inputSchema: {
          type: 'object',
          additionalProperties: false,
          required: ['query'],
          properties: {
            query: { type: 'string' },
            limit: { type: 'number' }
          }
        },
        knowledgeDomains: ['email', 'customer'],
        optional: true,
        requiresWorkspaceEnablement: true,
        supportsDryRun: true,
        async execute(input: { query: string; limit?: number }, context) {
          const token = await getValidGoogleAccessToken(context.workspace.id);
          return await gmail.search(token, input.query, input.limit);
        }
      },
      {
        name: 'gmail.read_thread',
        description: 'Read a Gmail thread by thread ID.',
        sideEffectClass: 'read',
        retrievalEligible: false,
        inputSchema: {
          type: 'object',
          additionalProperties: false,
          required: ['threadId'],
          properties: {
            threadId: { type: 'string' }
          }
        },
        knowledgeDomains: ['email', 'customer'],
        optional: true,
        requiresWorkspaceEnablement: true,
        supportsDryRun: true,
        async execute(input: { threadId: string }, context) {
          const token = await getValidGoogleAccessToken(context.workspace.id);
          return await gmail.readThread(token, input.threadId);
        }
      },
      {
        name: 'calendar.search_events',
        description: 'Search Google Calendar events. Use timeMin/timeMax (ISO 8601) to scope by date range. Pass an empty query to list all events in the range. For availability questions, use a limit large enough to cover the full window.',
        sideEffectClass: 'read',
        retrievalEligible: true,
        inputSchema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            query: { type: 'string', description: 'Text to match against event titles and descriptions. Omit to list all events in the time range.' },
            limit: { type: 'number' },
            timeMin: { type: 'string', description: 'ISO 8601 start of search window (inclusive). Defaults to 30 days ago.' },
            timeMax: { type: 'string', description: 'ISO 8601 end of search window (inclusive). Defaults to 60 days from now.' }
          }
        },
        knowledgeDomains: ['calendar', 'coordination'],
        optional: true,
        requiresWorkspaceEnablement: true,
        supportsDryRun: true,
        async execute(input: { query?: string; limit?: number; timeMin?: string; timeMax?: string }, context) {
          const token = await getValidGoogleAccessToken(context.workspace.id);
          const result = await calendar.searchEvents(token, input.query ?? '', input.limit ?? 25, {
            timeMin: input.timeMin,
            timeMax: input.timeMax
          });
          return {
            query: input.query ?? '',
            windowStart: input.timeMin,
            windowEnd: input.timeMax,
            eventCount: result.events.length,
            events: compactCalendarEvents(result.events)
          };
        }
      },
      {
        name: 'calendar.check_availability',
        description: 'Check whether the target user has calendar conflicts in a specific window. Use window=workday with YYYY-MM-DD for questions like "is Thursday good for a sync?" without a specific time.',
        sideEffectClass: 'read',
        retrievalEligible: true,
        inputSchema: {
          type: 'object',
          additionalProperties: false,
          required: ['date', 'window'],
          properties: {
            date: { type: 'string', description: 'Target local date in YYYY-MM-DD format.' },
            window: { type: 'string', enum: ['workday', 'custom'] },
            timeMin: { type: 'string', description: 'ISO 8601 custom window start. Required when window=custom.' },
            timeMax: { type: 'string', description: 'ISO 8601 custom window end. Required when window=custom.' }
          }
        },
        knowledgeDomains: ['calendar', 'coordination'],
        optional: true,
        requiresWorkspaceEnablement: true,
        supportsDryRun: true,
        async execute(
          input: { date: string; window: 'workday' | 'custom'; timeMin?: string; timeMax?: string },
          context
        ) {
          const token = await getValidGoogleAccessToken(context.workspace.id);
          const targetUserId = context.task?.targetUserId;
          let timezone: string;
          let windowStart: string;
          let windowEnd: string;

          if (input.window === 'custom') {
            if (!input.timeMin || !input.timeMax) {
              throw new Error('timeMin and timeMax are required when window=custom');
            }
            timezone = targetUserId
              ? getStore().getUser(context.workspace.id, targetUserId)?.schedule.timezone ?? 'UTC'
              : 'UTC';
            windowStart = input.timeMin;
            windowEnd = input.timeMax;
          } else {
            if (!targetUserId) {
              throw new Error('Target user is unavailable');
            }
            const user = getStore().getUser(context.workspace.id, targetUserId);
            if (!user) {
              throw new Error('Target user schedule is unavailable');
            }
            timezone = user.schedule.timezone;
            ({ windowStart, windowEnd } = workdayWindowForDate({
              date: input.date,
              timezone,
              workdayStartHour: user.schedule.workdayStartHour,
              workdayEndHour: user.schedule.workdayEndHour
            }));
          }

          return await calendar.checkAvailability(token, {
            timezone,
            windowStart,
            windowEnd
          });
        }
      }
    ]
  };
}
