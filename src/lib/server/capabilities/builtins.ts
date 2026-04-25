import { getChannelRegistry } from '#lib/server/capabilities/channel-registry';
import { getContextSourceRegistry } from '#lib/server/capabilities/context-source-registry';
import { getMemoryService } from '#lib/server/memory/service';
import { getNotionService } from '#lib/server/context-sources/notion';
import { writeThreadMemory } from '#lib/server/memory/markdown';
import { createSlackChannelAdapter } from '#lib/server/channels/slack/adapter';
import { getStore } from '#lib/server/persistence/store';
import { getToolRegistry } from '#lib/server/capabilities/tool-registry';
import type { ChannelMessage, ToolDefinition } from '#lib/types';

let initialized = false;

export function registerBuiltInTools(): void {
  if (initialized) {
    return;
  }

  const registry = getToolRegistry();
  const channels = getChannelRegistry();
  const contextSources = getContextSourceRegistry();
  const store = getStore();
  const memory = getMemoryService();

  channels.register(createSlackChannelAdapter());
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

  const notion = getNotionService();

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
          const results = await notion.search(query, 3);
          return results.results.map((result) => notion.toArtifact(result));
        }
      },
      { optional: true, source: 'core' }
    );
  }

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
        const result = await channels.postMessage(context.workspace, input.provider ?? 'slack', input.channelId, input.text);
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
      async execute(input: { workspaceId: string; slackUserId: string }) {
        return store.getUser(input.workspaceId, input.slackUserId)?.schedule ?? null;
      }
    },
    {
      name: 'user.get_preferences',
      description: 'Get user memory and preferences.',
      sideEffectClass: 'read',
      supportsDryRun: true,
      async execute(input: { workspaceId: string; slackUserId: string }) {
        return memory.getUserMemory(input.workspaceId, input.slackUserId);
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
        async execute(input: { query: string; limit?: number }) {
          return await notion.search(input.query, input.limit);
        }
      },
      {
        name: 'notion.read_page',
        description: 'Read the first blocks of a shared Notion page as plain text.',
        sideEffectClass: 'read',
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
        async execute(input: { pageId: string; maxBlocks?: number }) {
          return await notion.readPage(input.pageId, input.maxBlocks);
        }
      }
    );
  }

  for (const tool of tools) {
    registry.register(tool, { optional: tool.optional, source: 'core' });
  }

  initialized = true;
}
