import { getChannelRegistry } from '#lib/server/capabilities/channel-registry';
import { getContextSourceRegistry } from '#lib/server/capabilities/context-source-registry';
import { getMemoryService } from '#lib/server/memory/service';
import { getGitHubService, toArtifact as githubToArtifact } from '#lib/server/context-sources/github';
import { getGmailService, toArtifact as gmailToArtifact } from '#lib/server/context-sources/gmail';
import { getGoogleCalendarService, toArtifact as calendarToArtifact } from '#lib/server/context-sources/google-calendar';
import { getValidGoogleAccessToken } from '#lib/server/integrations/google-oauth';
import { getGranolaService, toArtifact as granolaToArtifact } from '#lib/server/context-sources/granola';
import { searchLocalFiles, toArtifact as localFsToArtifact } from '#lib/server/context-sources/local-fs';
import { getNotionService } from '#lib/server/context-sources/notion';
import {
  isObsidianConfigured,
  readObsidianNote,
  searchObsidianNotes,
  toArtifact as obsidianToArtifact
} from '#lib/server/context-sources/obsidian';
import { writeThreadMemory } from '#lib/server/memory/markdown';
import { createFileReadTool } from '#lib/server/tools/file-ops';
import { createShellExecTool } from '#lib/server/tools/shell';
import { createWebFetchTool } from '#lib/server/tools/web-fetch';
import { createWebSearchTool } from '#lib/server/tools/web-search';
import { createSlackChannelAdapter } from '#lib/server/channels/slack/adapter';
import { getSlackService } from '#lib/server/channels/slack/service';
import { createDiscordChannelAdapter } from '#lib/server/channels/discord/adapter';
import { getDiscordArchiveService, readDiscordThread, toArtifact as discordToArtifact } from '#lib/server/context-sources/discord-archive';
import { getStore } from '#lib/server/persistence/store';
import { getToolRegistry } from '#lib/server/capabilities/tool-registry';
import { localDateTimeToUtc } from '#lib/server/util/cron';
import type { ChannelMessage, ContextArtifact, ToolDefinition } from '#lib/types';

let initialized = false;

function slackSearchArtifact(result: {
  id: string;
  channelId: string;
  channelName?: string;
  threadTs: string;
  text: string;
  permalink?: string;
  userId?: string;
}): ContextArtifact {
  return {
    id: result.id,
    source: 'slack',
    type: 'other',
    title: result.channelName ? `#${result.channelName}` : result.channelId,
    text: result.text,
    url: result.permalink,
    metadata: {
      channelId: result.channelId,
      threadTs: result.threadTs,
      userId: result.userId
    }
  };
}

function compactCalendarEvents(events: Array<{ title: string; start?: string; end?: string }>) {
  return events.map((event) => ({
    title: event.title,
    start: event.start,
    end: event.end
  }));
}

function parseLocalDate(value: string): { year: number; month: number; day: number } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    throw new Error('date must use YYYY-MM-DD format');
  }

  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3])
  };
}

function workdayWindowForDate(input: { date: string; timezone: string; workdayStartHour: number; workdayEndHour: number }) {
  if (input.workdayEndHour <= input.workdayStartHour) {
    throw new Error('user workday is invalid');
  }

  const { year, month, day } = parseLocalDate(input.date);
  const windowStart = localDateTimeToUtc({
    year,
    month,
    day,
    hour: input.workdayStartHour,
    minute: 0
  }, input.timezone).toISOString();
  const windowEnd = localDateTimeToUtc({
    year,
    month,
    day,
    hour: input.workdayEndHour,
    minute: 0
  }, input.timezone).toISOString();

  return { windowStart, windowEnd };
}

export function registerBuiltInTools(): void {
  if (initialized) {
    return;
  }

  const registry = getToolRegistry();
  const channels = getChannelRegistry();
  const contextSources = getContextSourceRegistry();
  const store = getStore();
  const memory = getMemoryService();
  const slack = getSlackService();
  const discord = getDiscordArchiveService();

  channels.register(createSlackChannelAdapter());
  if (discord.isConfigured()) {
    channels.register(createDiscordChannelAdapter());
  }
  contextSources.register(
    {
      name: 'memory.linked_artifacts',
      description: 'Expose linked thread memory artifacts as grounding context.',
      optional: false,
      knowledgeDomains: ['documentation'],
      async retrieve(input) {
        return (input.context.memory.thread?.linkedArtifacts ?? []).map((artifact, index) => ({
          id: `${input.task.id}:linked-artifact:${index}`,
          source: 'memory.linked_artifacts',
          type: 'link',
          title: artifact,
          text: artifact,
          url: artifact.startsWith('http') ? artifact : undefined
        }));
      }
    },
    { optional: false, source: 'core' }
  );

  if (discord.isConfigured()) {
    contextSources.register(
      {
        name: 'discord.thread_search',
        description: 'Search recent Discord messages by the current thread text.',
        optional: true,
        knowledgeDomains: ['team', 'coordination'],
        async retrieve(input) {
          const query =
            input.context.thread.latestMessage ||
            input.context.thread.recentMessages.map((message) => message.text).join(' ');
          const results = await discord.searchMessages(input.workspace, query, 3);
          return results.pendingIndex ? [] : results.results.map((result) => discordToArtifact(result));
        }
      },
      { optional: true, source: 'core' }
    );
  }

  const notion = getNotionService();
  const github = getGitHubService();
  const granola = getGranolaService();
  const gmail = getGmailService();
  const calendar = getGoogleCalendarService();

  if (notion.isConfigured()) {
    contextSources.register(
      {
        name: 'notion.thread_search',
        description: 'Search shared Notion pages by the current Slack thread text.',
        optional: true,
        knowledgeDomains: ['documentation'],
        async retrieve(input) {
          const query =
            input.context.thread.latestMessage ||
            input.context.thread.recentMessages.map((message) => message.text).join(' ');
          const results = await notion.search(query, 3, input.workspace.id);
          return results.results.map((result) => notion.toArtifact(result));
        }
      },
      { optional: true, source: 'core' }
    );
  }

  if (github.isConfigured()) {
    contextSources.register(
      {
        name: 'github.thread_search',
        description: 'Search GitHub issues and pull requests by the current thread text.',
        optional: true,
        knowledgeDomains: ['code', 'documentation'],
        async retrieve(input) {
          const query =
            input.context.thread.latestMessage ||
            input.context.thread.recentMessages.map((message) => message.text).join(' ');
          const results = await github.search(query, 3, input.workspace.id);
          return results.results.map((result) => githubToArtifact(result));
        }
      },
      { optional: true, source: 'core' }
    );
  }

  if (granola.isConfigured()) {
    contextSources.register(
      {
        name: 'granola.thread_search',
        description: 'Search Granola meeting notes by the current thread text.',
        optional: true,
        knowledgeDomains: ['meeting'],
        async retrieve(input) {
          const query =
            input.context.thread.latestMessage ||
            input.context.thread.recentMessages.map((message) => message.text).join(' ');
          const results = await granola.search(query, 3);
          return results.results.map((result) => granolaToArtifact(result));
        }
      },
      { optional: true, source: 'core' }
    );
  }

  contextSources.register(
    {
      name: 'gmail.thread_search',
      description: 'Search Gmail threads by the current thread text.',
      optional: true,
      knowledgeDomains: ['email', 'customer'],
      async retrieve(input) {
        const token = await getValidGoogleAccessToken(input.workspace.id);
        const query =
          input.context.thread.latestMessage ||
          input.context.thread.recentMessages.map((message) => message.text).join(' ');
        const results = await gmail.search(token, query, 3);
        return results.results.map((result) => gmailToArtifact(result));
      }
    },
    { optional: true, source: 'core' }
  );

  contextSources.register(
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
    },
    { optional: true, source: 'core' }
  );

  contextSources.register(
    {
      name: 'localfs.thread_search',
      description: 'Search allowlisted local files by the current thread text.',
      optional: true,
      knowledgeDomains: ['code', 'documentation'],
      async retrieve(input) {
        const query =
          input.context.thread.latestMessage ||
          input.context.thread.recentMessages.map((message) => message.text).join(' ');
        const results = await searchLocalFiles(query, 3);
        return results.map((result) => localFsToArtifact(result));
      }
    },
    { optional: true, source: 'core' }
  );

  if (isObsidianConfigured()) {
    contextSources.register(
      {
        name: 'obsidian.thread_search',
        description: 'Search an Obsidian vault by the current thread text.',
        optional: true,
        knowledgeDomains: ['documentation', 'meeting'],
        async retrieve(input) {
          const query =
            input.context.thread.latestMessage ||
            input.context.thread.recentMessages.map((message) => message.text).join(' ');
          const results = await searchObsidianNotes(query, 3);
          return results.map((result) => obsidianToArtifact(result));
        }
      },
      { optional: true, source: 'core' }
    );
  }

  contextSources.register(
    {
      name: 'slack.thread_search',
      description: 'Search recent Slack messages by the current thread text.',
      optional: true,
      knowledgeDomains: ['team', 'coordination'],
      async retrieve(input) {
        const query =
          input.context.thread.latestMessage ||
          input.context.thread.recentMessages.map((message) => message.text).join(' ');
        const results = await slack.searchMessages(input.workspace, query, 3);
        return results.map((result) => slackSearchArtifact(result));
      }
    },
    { optional: true, source: 'core' }
  );

  const tools: Array<ToolDefinition<any, any>> = [
    {
      name: 'channel.fetch_thread',
      description: 'Fetch recent channel thread messages for the active thread.',
      sideEffectClass: 'read',
      supportsDryRun: true,
      async execute(input: { provider?: string; channelId: string; threadTs: string }, context): Promise<ChannelMessage[]> {
        return await channels.fetchThread(context.workspace, input);
      }
    },
    {
      name: 'discord.search',
      description: 'Search Discord messages in the active guild by free-text query.',
      sideEffectClass: 'read',
      retrievalEligible: true,
      optional: true,
      requiresWorkspaceEnablement: true,
      knowledgeDomains: ['team', 'coordination'],
      async execute(input: { query: string; limit?: number }, context) {
        const results = await discord.searchMessages(context.workspace, input.query, input.limit ?? 5);
        return results;
      }
    },
    {
      name: 'discord.read_thread',
      description: 'Read a Discord thread or message conversation by normalized thread reference.',
      sideEffectClass: 'read',
      retrievalEligible: false,
      optional: true,
      requiresWorkspaceEnablement: true,
      knowledgeDomains: ['team', 'coordination'],
      async execute(
        input: { channelId: string; threadTs: string; threadChannelId?: string; rootMessageId?: string },
        context
      ) {
        const thread = readDiscordThread(input);
        return await discord.fetchThreadMessages(context.workspace, thread);
      }
    },
    {
      name: 'channel.post_reply',
      description: 'Post a reply into a channel thread.',
      sideEffectClass: 'external_write',
      sessionModes: ['manual_review', 'auto_send_low_risk'],
      supportsDryRun: false,
      async execute(input: { provider?: string; channelId: string; threadTs: string; text: string }, context): Promise<{ ok: true }> {
        await channels.postReply(context.workspace, input, input.text);
        return { ok: true };
      }
    },
    {
      name: 'channel.post_message',
      description: 'Post a top-level channel message. Internal system use only.',
      sideEffectClass: 'external_write',
      sessionModes: ['manual_review', 'auto_send_low_risk'],
      supportsDryRun: false,
      async execute(input: { provider?: string; channelId: string; text: string }, context): Promise<{ ok: true; ts?: string }> {
        const result = await channels.postMessage(
          context.workspace,
          input.provider ?? context.workspace.provider,
          input.channelId,
          input.text
        );
        return { ok: true, ts: result.ts };
      }
    },
    {
      name: 'session.get_active',
      description: 'Inspect active session state for the current task.',
      sideEffectClass: 'read',
      supportsDryRun: true,
      async execute(_input: undefined, context) {
        return context.session ?? null;
      }
    },
    {
      name: 'user.get_schedule',
      description: 'Get the target user schedule.',
      sideEffectClass: 'read',
      supportsDryRun: true,
      async execute(input: { workspaceId: string; userId: string }) {
        return store.getUser(input.workspaceId, input.userId)?.schedule ?? null;
      }
    },
    {
      name: 'user.get_preferences',
      description: 'Get user memory and preferences.',
      sideEffectClass: 'read',
      supportsDryRun: true,
      async execute(input: { workspaceId: string; userId: string }) {
        return memory.getUserMemory(input.workspaceId, input.userId);
      }
    },
    {
      name: 'memory.thread.read',
      description: 'Read thread memory.',
      sideEffectClass: 'read',
      supportsDryRun: true,
      async execute(input: { workspaceId: string; channelId: string; threadTs: string }) {
        return memory.getThreadMemory(input.workspaceId, input.channelId, input.threadTs);
      }
    },
    {
      name: 'memory.thread.write',
      description: 'Write thread summary memory.',
      sideEffectClass: 'write',
      supportsDryRun: true,
      async execute(
        input: {
          workspaceId: string;
          channelId: string;
          threadTs: string;
          targetUserId?: string;
          summary?: string;
          openQuestions?: string[];
        },
        context
      ) {
        const next = memory.writeThreadSummary(
          context.workspace,
          input.channelId,
          input.threadTs,
          input.targetUserId,
          input.summary,
          input.openQuestions ?? []
        );
        return next;
      }
    },
    {
      name: 'memory.thread.write_markdown',
      description: 'Write inspectable markdown thread memory file.',
      sideEffectClass: 'write',
      supportsDryRun: true,
      async execute(input: { context: any }) {
        return await writeThreadMemory(input.context);
      }
    },
    {
      name: 'memory.workspace.read',
      description: 'Read workspace memory.',
      sideEffectClass: 'read',
      supportsDryRun: true,
      async execute(input: { workspaceId: string }) {
        return memory.getWorkspaceMemory(input.workspaceId);
      }
    },
    {
      name: 'memory.thread.link_artifact',
      description: 'Link an external artifact URL or identifier to the active thread memory.',
      sideEffectClass: 'write',
      supportsDryRun: true,
      async execute(input: { channelId: string; threadTs: string; artifact: string }, context) {
        return memory.linkThreadArtifact(context.workspace, input.channelId, input.threadTs, input.artifact);
      }
    },
    {
      name: 'memory.user.write_feedback',
      description: 'Record feedback memory from operator actions.',
      sideEffectClass: 'write',
      optional: true,
      sessionModes: ['manual_review', 'auto_send_low_risk'],
      requiresWorkspaceEnablement: true,
      async execute(input: {
        workspaceId: string;
        sessionId?: string;
        threadTs: string;
        originalAction: any;
        finalAction: any;
        note: string;
      }) {
        return memory.recordFeedback(input);
      }
    },
    {
      name: 'reminder.schedule',
      description: 'Schedule a reminder for a thread.',
      sideEffectClass: 'write',
      supportsDryRun: false,
      async execute(
        input: {
          workspaceId: string;
          sessionId?: string;
          channelId: string;
          threadTs: string;
          targetUserId: string;
          dueAt: string;
        }
      ) {
        return store.scheduleReminder(input);
      }
    },
    {
      name: 'queue.enqueue',
      description: 'Queue a continuity action for review.',
      sideEffectClass: 'write',
      supportsDryRun: true,
      async execute(input: {
        workspaceId: string;
        sessionId?: string;
        channelId: string;
        threadTs: string;
        targetUserId: string;
        actionType: any;
        disposition: any;
        message: string;
        reason: string;
        confidence: number;
        provider?: any;
      }) {
        return store.insertAction(input);
      }
    },
    {
      name: 'queue.update',
      description: 'Update a queued continuity action after operator review.',
      sideEffectClass: 'write',
      sessionModes: ['manual_review', 'auto_send_low_risk'],
      supportsDryRun: false,
      async execute(input: {
        id: string;
        disposition?: any;
        message?: string;
        reason?: string;
        action?: any;
      }) {
        return store.updateReviewItem(input.id, input);
      }
    }
  ];

  if (notion.isConfigured()) {
    tools.push(
      {
        name: 'notion.search',
        description: 'Search shared Notion pages by title and return matching page IDs, titles, and URLs.',
        sideEffectClass: 'read',
        retrievalEligible: true,
        inputSchema: {
          type: 'object',
          additionalProperties: false,
          required: ['query'],
          properties: {
            query: { type: 'string' },
            limit: { type: 'number' }
          }
        },
        knowledgeDomains: ['documentation'],
        optional: true,
        requiresWorkspaceEnablement: true,
        supportsDryRun: true,
        async execute(input: { query: string; limit?: number }, context) {
          return await notion.search(input.query, input.limit, context.workspace.id);
        }
      },
      {
        name: 'notion.read_page',
        description: 'Read the first blocks of a shared Notion page as plain text.',
        sideEffectClass: 'read',
        retrievalEligible: false,
        inputSchema: {
          type: 'object',
          additionalProperties: false,
          required: ['pageId'],
          properties: {
            pageId: { type: 'string' },
            maxBlocks: { type: 'number' }
          }
        },
        knowledgeDomains: ['documentation'],
        optional: true,
        requiresWorkspaceEnablement: true,
        supportsDryRun: true,
        async execute(input: { pageId: string; maxBlocks?: number }, context) {
          return await notion.readPage(input.pageId, input.maxBlocks, context.workspace.id);
        }
      }
    );
  }

  if (github.isConfigured()) {
    tools.push(
      {
        name: 'github.search',
        description: 'Search GitHub issues and pull requests by query text.',
        sideEffectClass: 'read',
        retrievalEligible: true,
        inputSchema: {
          type: 'object',
          additionalProperties: false,
          required: ['query'],
          properties: {
            query: { type: 'string' },
            limit: { type: 'number' }
          }
        },
        knowledgeDomains: ['code', 'documentation'],
        optional: true,
        requiresWorkspaceEnablement: true,
        supportsDryRun: true,
        async execute(input: { query: string; limit?: number }, context) {
          return await github.search(input.query, input.limit, context.workspace.id);
        }
      },
      {
        name: 'github.read_issue',
        description: 'Read a GitHub issue by repository and number.',
        sideEffectClass: 'read',
        retrievalEligible: false,
        inputSchema: {
          type: 'object',
          additionalProperties: false,
          required: ['repository', 'number'],
          properties: {
            repository: { type: 'string' },
            number: { type: 'number' }
          }
        },
        knowledgeDomains: ['code', 'documentation'],
        optional: true,
        requiresWorkspaceEnablement: true,
        supportsDryRun: true,
        async execute(input: { repository: string; number: number }, context) {
          return await github.readIssue(input.repository, input.number, context.workspace.id);
        }
      },
      {
        name: 'github.read_pr',
        description: 'Read a GitHub pull request by repository and number.',
        sideEffectClass: 'read',
        retrievalEligible: false,
        inputSchema: {
          type: 'object',
          additionalProperties: false,
          required: ['repository', 'number'],
          properties: {
            repository: { type: 'string' },
            number: { type: 'number' }
          }
        },
        knowledgeDomains: ['code', 'documentation'],
        optional: true,
        requiresWorkspaceEnablement: true,
        supportsDryRun: true,
        async execute(input: { repository: string; number: number }, context) {
          return await github.readPullRequest(input.repository, input.number, context.workspace.id);
        }
      }
    );
  }

  if (granola.isConfigured()) {
    tools.push(
      {
        name: 'granola.search',
        description: 'Search Granola meeting notes by query text.',
        sideEffectClass: 'read',
        retrievalEligible: true,
        inputSchema: {
          type: 'object',
          additionalProperties: false,
          required: ['query'],
          properties: {
            query: { type: 'string' },
            limit: { type: 'number' }
          }
        },
        knowledgeDomains: ['meeting'],
        optional: true,
        requiresWorkspaceEnablement: true,
        supportsDryRun: true,
        async execute(input: { query: string; limit?: number }) {
          return await granola.search(input.query, input.limit);
        }
      },
      {
        name: 'granola.read_meeting',
        description: 'Read a Granola meeting note by ID.',
        sideEffectClass: 'read',
        retrievalEligible: false,
        inputSchema: {
          type: 'object',
          additionalProperties: false,
          required: ['noteId'],
          properties: {
            noteId: { type: 'string' }
          }
        },
        knowledgeDomains: ['meeting'],
        optional: true,
        requiresWorkspaceEnablement: true,
        supportsDryRun: true,
        async execute(input: { noteId: string }) {
          return await granola.readMeeting(input.noteId, true);
        }
      }
    );
  }

  tools.push(
    {
      name: 'gmail.search',
      description: 'Search Gmail threads by query text.',
      sideEffectClass: 'read',
      retrievalEligible: true,
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
    }
  );

  tools.push({
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
  });

  tools.push({
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
          ? store.getUser(context.workspace.id, targetUserId)?.schedule.timezone ?? 'UTC'
          : 'UTC';
        windowStart = input.timeMin;
        windowEnd = input.timeMax;
      } else {
        if (!targetUserId) {
          throw new Error('Target user is unavailable');
        }
        const user = store.getUser(context.workspace.id, targetUserId);
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
  });

  tools.push(
    {
      name: 'slack.search',
      description: 'Search Slack messages by query text.',
      sideEffectClass: 'read',
      retrievalEligible: true,
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['query'],
        properties: {
          query: { type: 'string' },
          limit: { type: 'number' }
        }
      },
      knowledgeDomains: ['team', 'coordination'],
      optional: true,
      requiresWorkspaceEnablement: true,
      supportsDryRun: true,
      async execute(input: { query: string; limit?: number }, context) {
        return { results: await slack.searchMessages(context.workspace, input.query, input.limit) };
      }
    },
    {
      name: 'slack.read_thread',
      description: 'Read a Slack thread by channel and thread timestamp.',
      sideEffectClass: 'read',
      retrievalEligible: false,
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['channelId', 'threadTs'],
        properties: {
          channelId: { type: 'string' },
          threadTs: { type: 'string' }
        }
      },
      knowledgeDomains: ['team', 'coordination'],
      optional: true,
      requiresWorkspaceEnablement: true,
      supportsDryRun: true,
      async execute(input: { channelId: string; threadTs: string }, context) {
        return await slack.fetchThreadMessages(context.workspace, {
          provider: 'slack',
          channelId: input.channelId,
          threadTs: input.threadTs
        });
      }
    }
  );

  if (isObsidianConfigured()) {
    tools.push(
      {
        name: 'obsidian.search',
        description: 'Search an Obsidian vault by query text.',
        sideEffectClass: 'read',
        retrievalEligible: true,
        inputSchema: {
          type: 'object',
          additionalProperties: false,
          required: ['query'],
          properties: {
            query: { type: 'string' },
            limit: { type: 'number' }
          }
        },
        knowledgeDomains: ['documentation', 'meeting'],
        optional: true,
        requiresWorkspaceEnablement: true,
        supportsDryRun: true,
        async execute(input: { query: string; limit?: number }) {
          return { results: await searchObsidianNotes(input.query, input.limit ?? 3) };
        }
      },
      {
        name: 'obsidian.read_note',
        description: 'Read an Obsidian note by path.',
        sideEffectClass: 'read',
        retrievalEligible: false,
        inputSchema: {
          type: 'object',
          additionalProperties: false,
          required: ['path'],
          properties: {
            path: { type: 'string' }
          }
        },
        knowledgeDomains: ['documentation', 'meeting'],
        optional: true,
        requiresWorkspaceEnablement: true,
        supportsDryRun: true,
        async execute(input: { path: string }) {
          return await readObsidianNote(input.path);
        }
      }
    );
  }

  tools.push(
    createWebSearchTool(),
    createWebFetchTool(),
    createFileReadTool(),
    createShellExecTool()
  );

  for (const tool of tools) {
    registry.register(tool, { optional: tool.optional, source: 'core' });
  }

  initialized = true;
}
