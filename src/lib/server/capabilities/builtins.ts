import { getChannelRegistry } from '#lib/server/capabilities/channel-registry';
import { getContextSourceRegistry } from '#lib/server/capabilities/context-source-registry';
import { getMemoryService } from '#lib/server/memory/service';
import { searchLocalFiles, toArtifact as localFsToArtifact } from '#lib/server/context-sources/local-fs';
import { readMemoryPage } from '#lib/server/memory/wiki';
import { createFileReadTool } from '#lib/server/tools/file-ops';
import { createShellExecTool } from '#lib/server/tools/shell';
import { createWebFetchTool } from '#lib/server/tools/web-fetch';
import { createWebSearchTool } from '#lib/server/tools/web-search';
import { registerBuiltInChannelPlugins } from '#lib/server/channels/register-builtins';
import { getSlackService } from '#lib/server/channels/slack/service';
import { getDiscordArchiveService, readDiscordThread, toArtifact as discordToArtifact } from '#lib/server/context-sources/discord-archive';
import { getStore } from '#lib/server/persistence/store';
import { getToolRegistry } from '#lib/server/capabilities/tool-registry';
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

  registerBuiltInChannelPlugins();
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

  contextSources.register(
    {
      name: 'discord.thread_search',
      description: 'Search recent Discord messages by the current thread text.',
      optional: true,
      knowledgeDomains: ['team', 'coordination'],
      async retrieve(input) {
        if (input.workspace.provider !== 'discord' || !discord.isConfigured()) {
          return [];
        }
        const query =
          input.context.thread.latestMessage ||
          input.context.thread.recentMessages.map((message) => message.text).join(' ');
        const results = await discord.searchMessages(input.workspace, query, 3);
        return results.pendingIndex ? [] : results.results.map((result) => discordToArtifact(result));
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
      async execute(
        input: { provider?: string; channelId: string; threadTs: string; threadChannelId?: string; rootMessageId?: string },
        context
      ): Promise<ChannelMessage[]> {
        return await channels.fetchThread(context.workspace, input);
      }
    },
    {
      name: 'discord.search',
      description: 'Search Discord messages in the active guild by free-text query.',
      sideEffectClass: 'read',
      retrievalEligible: true,
      retrieval: { profile: 'team_discussion' },
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
      async execute(
        input: { provider?: string; channelId: string; threadTs: string; threadChannelId?: string; rootMessageId?: string; text: string },
        context
      ): Promise<{ ok: true }> {
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
          evidenceStatus?: any;
        },
        context
      ) {
        const next = memory.writeThreadSummary(
          context.workspace,
          input.channelId,
          input.threadTs,
          input.targetUserId,
          input.summary,
          input.openQuestions ?? [],
          input.evidenceStatus
        );
        return next;
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
      name: 'memory.wiki.read_page',
      description: 'Read one indexed Murph markdown memory page for stable or follow-up context.',
      sideEffectClass: 'read',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['path'],
        properties: {
          path: { type: 'string' },
          maxChars: { type: 'number' }
        }
      },
      knowledgeDomains: ['documentation', 'team', 'coordination'],
      retrievalEligible: false,
      supportsDryRun: true,
      async execute(input: { path: string; maxChars?: number }) {
        return await readMemoryPage(input.path, input.maxChars);
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
        contextSnapshot?: any;
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

  tools.push(
    {
      name: 'slack.search',
      description: 'Search Slack messages by query text.',
      sideEffectClass: 'read',
      retrievalEligible: true,
      retrieval: { profile: 'team_discussion' },
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
