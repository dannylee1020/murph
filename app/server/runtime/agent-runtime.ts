import { getContextSourceRegistry } from '#app/server/capabilities/context-source-registry';
import { getMemoryService } from '#app/server/memory/service';
import { getModelProvider } from '#app/server/providers/index';
import { runGroundingLoop } from '#app/server/runtime/pi-agent-loop';
import { expandContextSources } from '#app/server/runtime/domain-expansion';
import { buildRuntimeToolCallingPlan, listAvailableTools } from '#app/server/runtime/tool-calling-plan';
import { outputSummary, truncateToolOutput } from '#app/server/runtime/tool-output';
import { selectSkills } from '#app/server/skills/selection';
import { loadSkills } from '#app/server/skills/loader';
import { getStore } from '#app/server/persistence/store';
import { getToolRegistry } from '#app/server/capabilities/tool-registry';
import { getRuntimeEnv } from '#app/server/util/env';
import { getSourceIndexCatalog } from '../source-index/catalog.js';
import {
  buildNormalizedRetrievalRequest,
  deterministicRetrievalInputForTool
} from '#app/server/runtime/retrieval-request';
import type {
  AgentToolResult,
  AgentToolInventoryItem,
  AutopilotSession,
  ChannelMessage,
  ContextAssembly,
  ContextArtifact,
  ContinuityCase,
  ContinuityTask,
  ProposedAction,
  ProviderDraftResult,
  RuntimeEventType,
  SkillManifest,
  Workspace
} from '#app/types';

const MAX_TOOL_CALLS_PER_RUN = 12;

export interface AgentRunResult {
  context: ContextAssembly;
  proposedAction: ProposedAction;
  selectedSkillNames: string[];
  domainExpansion: Record<string, string[]>;
  toolsUsed: string[];
  toolResults: AgentToolResult[];
  runtimeEvents: Array<{ type: RuntimeEventType; payload: unknown }>;
}

interface PostLoopEvidence {
  artifacts: ContextArtifact[];
  linkedArtifacts: string[];
}

function inferParticipants(messages: ChannelMessage[]): string[] {
  return [...new Set(messages.map((message) => message.userId).filter(Boolean))] as string[];
}

function inferCaseFromText(text: string): ContinuityCase {
  const normalized = text.toLowerCase();

  if (normalized.includes('blocked') || normalized.includes('unblock')) {
    return 'blocker';
  }

  if (normalized.includes('when') || normalized.includes('availability')) {
    return 'availability';
  }

  if (normalized.includes('clarify') || normalized.includes('?')) {
    return 'clarification';
  }

  if (normalized.includes('handoff') || normalized.includes('update')) {
    return 'handoff';
  }

  if (normalized.includes('status')) {
    return 'status_request';
  }

  return 'unknown';
}

function toolResultsToArtifacts(toolResults: AgentToolResult[]): ContextArtifact[] {
  return toolResults.filter((result) => result.ok).map((result) => ({
    id: `tool:${result.id}`,
    source: result.name,
    type: 'other',
    title: result.ok ? `${result.name} result` : `${result.name} error`,
    text: JSON.stringify(result.ok ? result.output : result.error)
  }));
}

function objectInput(input: unknown): Record<string, unknown> {
  return input && typeof input === 'object' && !Array.isArray(input) ? input as Record<string, unknown> : {};
}

function mergeArtifacts(base: ContextArtifact[], updates: ContextArtifact[]): ContextArtifact[] {
  const merged = [...base];
  const indexById = new Map(merged.map((artifact, index) => [artifact.id, index]));

  for (const artifact of updates) {
    const existingIndex = indexById.get(artifact.id);
    if (existingIndex === undefined) {
      indexById.set(artifact.id, merged.length);
      merged.push(artifact);
      continue;
    }

    merged[existingIndex] = artifact;
  }

  return merged;
}

function mergeLinkedArtifacts(base: string[], updates: string[]): string[] {
  const merged: string[] = [];
  const seen = new Set<string>();

  for (const value of [...base, ...updates]) {
    if (!seen.has(value)) {
      seen.add(value);
      merged.push(value);
    }
  }

  return merged;
}

function notionPageArtifact(page: unknown): ContextArtifact | null {
  if (!page || typeof page !== 'object') {
    return null;
  }

  if (!('id' in page) || typeof page.id !== 'string' || !('title' in page) || typeof page.title !== 'string') {
    return null;
  }

  const text = 'text' in page && typeof page.text === 'string' ? page.text : page.title;
  const url = 'url' in page && typeof page.url === 'string' ? page.url : undefined;

  return {
    id: `notion:${page.id}`,
    source: 'notion',
    type: 'document',
    title: page.title,
    text,
    url,
    metadata: { notionPageId: page.id }
  };
}

export class AgentRuntime {
  private readonly store = getStore();
  private readonly memory = getMemoryService();
  private readonly tools = getToolRegistry();
  private readonly contextSources = getContextSourceRegistry();

  async run(task: ContinuityTask, session: AutopilotSession, workspace: Workspace): Promise<AgentRunResult> {
    const context = await this.buildContext(task, session, workspace);
    const { proposedAction, toolsUsed, toolResults, draft, runtimeEvents, postLoopEvidence } = await this.proposeAction(context, session, workspace);
    const enrichedContext: ContextAssembly = {
      ...context,
      artifacts: mergeArtifacts(context.artifacts, [
        ...toolResultsToArtifacts(toolResults),
        ...postLoopEvidence.artifacts
      ]),
      linkedArtifacts: mergeLinkedArtifacts(context.linkedArtifacts, postLoopEvidence.linkedArtifacts),
      summary: draft.summary,
      unresolvedQuestions: draft.unresolvedQuestions,
      continuityCase: draft.continuityCase
    };

    return {
      context: enrichedContext,
      proposedAction,
      selectedSkillNames: enrichedContext.skills.map((skill) => skill.name),
      domainExpansion: {},
      toolsUsed,
      toolResults,
      runtimeEvents
    };
  }

  private async buildContext(
    task: ContinuityTask,
    session: AutopilotSession,
    workspace: Workspace
  ): Promise<ContextAssembly> {
    const recentMessagesPromise = this.tools.execute<
      { channelId: string; threadTs: string },
      ChannelMessage[]
    >('channel.fetch_thread', task.thread, { workspace, task }).catch((error) => {
      console.warn('[runtime] failed to fetch channel thread:', error instanceof Error ? error.message : error);
      return [];
    });
    const userMemoryPromise = task.targetUserId
      ? this.tools.execute<{ workspaceId: string; userId: string }, ContextAssembly['memory']['user']>(
          'user.get_preferences',
          {
            workspaceId: workspace.id,
            userId: task.targetUserId
          },
          { workspace, task }
        )
      : Promise.resolve(undefined);
    const workspaceMemoryPromise = this.tools.execute<{ workspaceId: string }, ContextAssembly['memory']['workspace']>(
      'memory.workspace.read',
      { workspaceId: workspace.id },
      { workspace, task }
    );
    const threadMemoryPromise = this.tools.execute<
      { workspaceId: string; channelId: string; threadTs: string; targetUserId?: string },
      ContextAssembly['memory']['thread']
    >(
      'memory.thread.read',
      {
        workspaceId: workspace.id,
        channelId: task.thread.channelId,
        threadTs: task.thread.threadTs,
        targetUserId: task.targetUserId
      },
      { workspace, task }
    );
    const allSkillsPromise = loadSkills();
    const allTools = this.tools.list();
    const [
      recentMessages,
      userMemory,
      workspaceMemory,
      threadMemory,
      allSkills
    ] = await Promise.all([
      recentMessagesPromise,
      userMemoryPromise,
      workspaceMemoryPromise,
      threadMemoryPromise,
      allSkillsPromise
    ]);
    const resolvedMessages = recentMessages.length > 0
      ? recentMessages
      : task.triggerMessage
        ? [task.triggerMessage]
        : [];
    const latestMessage = task.triggerMessage?.text ?? resolvedMessages.at(-1)?.text ?? '';
    const selectedSkills = selectSkills({
      skills: allSkills,
      channel: task.thread.provider ?? 'slack',
      sessionMode: session.mode,
      tools: allTools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        sideEffectClass: tool.sideEffectClass,
        inputSchema: tool.inputSchema,
        knowledgeDomains: tool.knowledgeDomains,
        retrievalEligible: tool.retrievalEligible,
        retrieval: tool.retrieval
      })),
      workspaceMemory,
    });
    const { availableTools } = listAvailableTools({
      allTools,
      workspaceMemory,
      sessionMode: session.mode
    });
    const baseContext: Omit<ContextAssembly, 'artifacts' | 'summary' | 'unresolvedQuestions' | 'continuityCase'> = {
      workspaceId: workspace.id,
      task,
      targetUserId: task.targetUserId,
      thread: {
        ref: task.thread,
        latestMessage,
        recentMessages: resolvedMessages,
        participants: inferParticipants(resolvedMessages)
      },
      memory: {
        user: userMemory ?? (task.targetUserId ? this.memory.getUserMemory(workspace.id, task.targetUserId) : undefined),
        workspace: workspaceMemory,
        thread: threadMemory
      },
      skills: selectedSkills,
      availableTools,
      linkedArtifacts: threadMemory.linkedArtifacts,
      sourceIndexHints: await this.sourceIndexHints(workspace.id, latestMessage)
    };
    const contextSourceNames = expandContextSources({
      selectedSkills,
      allSources: this.contextSources.list(),
      workspaceMemory
    });
    const artifacts = await this.contextSources.retrieve(contextSourceNames.explicit, contextSourceNames.optional, {
      workspace,
      task,
      context: baseContext,
      enabledContextSources: workspaceMemory.enabledContextSources,
      maxOptionalSources: 0
    });
    return {
      ...baseContext,
      artifacts,
      contextSources: contextSourceNames,
      availableTools,
      continuityCase: inferCaseFromText(latestMessage),
      summary: latestMessage,
      unresolvedQuestions: latestMessage.includes('?') ? [latestMessage] : []
    };
  }

  private async sourceIndexHints(workspaceId: string, query: string): Promise<ContextAssembly['sourceIndexHints']> {
    if (!query.trim()) {
      return [];
    }
    try {
      const catalog = getSourceIndexCatalog();
      await catalog.reload();
      return catalog.hintsFor({ workspaceId, query });
    } catch (error) {
      console.warn('[runtime] failed to load source index hints:', error instanceof Error ? error.message : error);
      return [];
    }
  }

  private async proposeAction(
    context: ContextAssembly,
    session: AutopilotSession,
    workspace: Workspace
  ): Promise<{
    draft: ProviderDraftResult;
    proposedAction: ProposedAction;
    toolsUsed: string[];
    toolResults: AgentToolResult[];
    runtimeEvents: Array<{ type: RuntimeEventType; payload: unknown }>;
    postLoopEvidence: PostLoopEvidence;
  }> {
    const runtimeEnv = getRuntimeEnv();
    const provider = getModelProvider();
    const toolCallingPlan = buildRuntimeToolCallingPlan({
      context,
      allTools: this.tools.list(),
      sessionMode: session.mode,
      policy: session.policy?.compiled
    });
    const postLoopEvidence: PostLoopEvidence = {
      artifacts: [],
      linkedArtifacts: []
    };
    const deterministicRetrieval = {
      toolsUsed: [] as string[],
      toolResults: [] as AgentToolResult[],
      runtimeEvents: [] as Array<{ type: RuntimeEventType; payload: unknown }>
    };

    try {
      let result = await runGroundingLoop({
        context: {
          workspaceId: context.workspaceId,
          task: context.task,
          targetUserId: context.targetUserId,
          thread: context.thread,
          memory: context.memory,
          skills: context.skills,
          availableTools: toolCallingPlan.availableTools,
          linkedArtifacts: context.linkedArtifacts,
          artifacts: context.artifacts
        },
        workspace,
        provider: provider.name,
        model: runtimeEnv.defaultModel,
        maxToolCallsPerRun: MAX_TOOL_CALLS_PER_RUN,
        groundingDirective: toolCallingPlan.groundingDirective,
        retrievalToolNames: toolCallingPlan.retrievalToolNames,
        defaultToolInput: (name, input) => this.defaultToolInput(name, input, context),
        enrichToolOutput: async (name, output, toolsUsed, runtimeEvents) =>
          await this.enrichSearchResultForGrounding(
            name,
            output,
            context,
            workspace,
            toolsUsed,
            runtimeEvents,
            postLoopEvidence
          ),
        linkThreadArtifact: (url) => {
          this.memory.linkThreadArtifact(
            workspace,
            context.thread.ref.channelId,
            context.thread.ref.threadTs,
            url,
            context.targetUserId
          );
          postLoopEvidence.linkedArtifacts.push(url);
        },
        retrieveAll: async (input, toolsUsed, runtimeEvents) => {
          const requestFocus = input && typeof input === 'object' && !Array.isArray(input) &&
            'requestFocus' in input && typeof (input as { requestFocus?: unknown }).requestFocus === 'string'
            ? (input as { requestFocus: string }).requestFocus
            : undefined;
          const retrieval = await this.runDeterministicRetrieval(
            context,
            workspace,
            toolCallingPlan.fanoutTools,
            postLoopEvidence,
            requestFocus
          );
          for (const tool of retrieval.toolsUsed) {
            toolsUsed.push(tool);
          }
          runtimeEvents.push(...retrieval.runtimeEvents);
          return {
            toolResults: retrieval.toolResults,
            output: {
              requestFocus: requestFocus ?? context.thread.latestMessage,
              results: retrieval.toolResults
            }
          };
        }
      });
      let retrievalAttempted = result.retrievalAttempted;
      if (
        toolCallingPlan.groundingDirective.required &&
        toolCallingPlan.retrievalToolNames.length > 0 &&
        !retrievalAttempted &&
        result.draft.proposedAction.type === 'reply'
      ) {
        retrievalAttempted = false;
      }
      const draft = toolCallingPlan.groundingDirective.required && toolCallingPlan.retrievalToolNames.length > 0 && !retrievalAttempted
        && result.draft.proposedAction.type === 'reply'
        ? {
            continuityCase: result.draft.continuityCase,
            summary: result.draft.summary,
            unresolvedQuestions: result.draft.unresolvedQuestions,
            proposedAction: {
              type: 'defer' as const,
              message: 'I checked the current thread context, but I still need to verify the source-of-truth before answering. Adding this to the queue for review when she is back.',
              reason: 'Current context was insufficient for a factual answer, and the model did not attempt the available retrieval tools.',
              confidence: 0.35
            }
          }
        : result.draft;

      return {
        draft,
        proposedAction: {
          ...draft.proposedAction,
          toolsUsed: mergeLinkedArtifacts(deterministicRetrieval.toolsUsed, result.toolsUsed)
        },
        toolsUsed: mergeLinkedArtifacts(deterministicRetrieval.toolsUsed, result.toolsUsed),
        toolResults: [...deterministicRetrieval.toolResults, ...result.toolResults],
        runtimeEvents: [...deterministicRetrieval.runtimeEvents, ...result.runtimeEvents],
        postLoopEvidence
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Provider tool turn failed';
      const runtimeEvents: Array<{ type: RuntimeEventType; payload: unknown }> = [{
        type: 'agent.model.failed',
        payload: {
          provider: provider.name,
          phase: 'tool_turn',
          error: message
        }
      }, {
        type: 'agent.model.started',
        payload: { provider: provider.name, round: 'fallback' }
      }];
      const toolResults: AgentToolResult[] = [];
      const toolsUsed: string[] = [];
      try {
        const draft = await provider.summarizeAndPropose({
          workspaceId: context.workspaceId,
          task: context.task,
          targetUserId: context.targetUserId,
          thread: context.thread,
          memory: context.memory,
          skills: context.skills,
          availableTools: toolCallingPlan.availableTools,
          linkedArtifacts: context.linkedArtifacts,
          artifacts: [...context.artifacts, ...toolResultsToArtifacts(toolResults)]
        });

        return {
          draft,
          proposedAction: {
            ...draft.proposedAction,
            toolsUsed: mergeLinkedArtifacts(deterministicRetrieval.toolsUsed, toolsUsed)
          },
          toolsUsed: mergeLinkedArtifacts(deterministicRetrieval.toolsUsed, toolsUsed),
          toolResults: [...deterministicRetrieval.toolResults, ...toolResults],
          postLoopEvidence,
          runtimeEvents: [
            ...deterministicRetrieval.runtimeEvents,
            ...runtimeEvents,
            {
              type: 'agent.model.completed',
              payload: {
                action: draft.proposedAction.type,
                reason: draft.proposedAction.reason,
                confidence: draft.proposedAction.confidence
              }
            }
          ]
        };
      } catch {
        const draft: ProviderDraftResult = {
          continuityCase: context.continuityCase,
          summary: context.summary ?? context.thread.latestMessage,
          unresolvedQuestions: context.unresolvedQuestions,
          proposedAction: {
            type: 'abstain',
            message: '',
            reason: error instanceof Error ? `Provider request failed: ${error.message}` : 'Provider request failed',
            confidence: 0,
            toolsUsed
          }
        };

        return {
          draft,
          proposedAction: draft.proposedAction,
          toolsUsed: mergeLinkedArtifacts(deterministicRetrieval.toolsUsed, toolsUsed),
          toolResults: [...deterministicRetrieval.toolResults, ...toolResults],
          postLoopEvidence,
          runtimeEvents: [
            ...deterministicRetrieval.runtimeEvents,
            ...runtimeEvents,
            {
              type: 'agent.model.completed',
              payload: {
                action: draft.proposedAction.type,
                reason: draft.proposedAction.reason,
                confidence: draft.proposedAction.confidence
              }
            }
          ]
        };
      }
    }
  }

  private async runDeterministicRetrieval(
    context: ContextAssembly,
    workspace: Workspace,
    retrievalTools: AgentToolInventoryItem[],
    postLoopEvidence: PostLoopEvidence,
    requestFocus?: string
  ): Promise<{
    toolsUsed: string[];
    toolResults: AgentToolResult[];
    runtimeEvents: Array<{ type: RuntimeEventType; payload: unknown }>;
  }> {
    const retrievalContext = requestFocus
      ? {
          ...context,
          thread: {
            ...context.thread,
            latestMessage: requestFocus,
            recentMessages: []
          }
        }
      : context;
    const retrievalRequest = buildNormalizedRetrievalRequest(retrievalContext);
    const retrievalTasks = retrievalTools.flatMap((tool) => {
      const input = deterministicRetrievalInputForTool(tool, retrievalRequest);
      return input ? [{ tool, input }] : [];
    });

    const results = await Promise.all(retrievalTasks.map(async ({ tool, input }) => {
      const id = `auto-retrieval:${tool.name}`;
      const localRuntimeEvents: Array<{ type: RuntimeEventType; payload: unknown }> = [{
        type: 'agent.tool.requested',
        payload: {
          id,
          name: tool.name,
          reason: 'Deterministic retrieval fanout',
          input
        }
      }];
      const localToolsUsed: string[] = [];
      const localPostLoopEvidence: PostLoopEvidence = {
        artifacts: [],
        linkedArtifacts: []
      };

      try {
        const output = await this.tools.execute(tool.name, input, {
          workspace,
          task: context.task,
          workspaceMemory: context.memory.workspace
        });
        localToolsUsed.push(tool.name);
        const enrichedOutput = await this.enrichSearchResultForGrounding(
          tool.name,
          output,
          context,
          workspace,
          localToolsUsed,
          localRuntimeEvents,
          localPostLoopEvidence
        );
        const toolResult: AgentToolResult = {
          id,
          name: tool.name,
          ok: true,
          output: truncateToolOutput(enrichedOutput)
        };
        localRuntimeEvents.push({
          type: 'agent.tool.completed',
          payload: {
            id,
            name: tool.name,
            ok: true,
            outputSummary: outputSummary(enrichedOutput)
          }
        });
        return {
          toolsUsed: localToolsUsed,
          toolResults: [toolResult],
          runtimeEvents: localRuntimeEvents,
          postLoopEvidence: localPostLoopEvidence
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Tool execution failed';
        const toolResult: AgentToolResult = {
          id,
          name: tool.name,
          ok: false,
          error: message
        };
        localRuntimeEvents.push({
          type: 'agent.tool.completed',
          payload: {
            id,
            name: tool.name,
            ok: false,
            error: message
          }
        });
        return {
          toolsUsed: localToolsUsed,
          toolResults: [toolResult],
          runtimeEvents: localRuntimeEvents,
          postLoopEvidence: localPostLoopEvidence
        };
      }
    }));

    for (const result of results) {
      postLoopEvidence.artifacts = mergeArtifacts(postLoopEvidence.artifacts, result.postLoopEvidence.artifacts);
      postLoopEvidence.linkedArtifacts = mergeLinkedArtifacts(
        postLoopEvidence.linkedArtifacts,
        result.postLoopEvidence.linkedArtifacts
      );
    }

    return {
      toolsUsed: results.flatMap((result) => result.toolsUsed),
      toolResults: results.flatMap((result) => result.toolResults),
      runtimeEvents: results.flatMap((result) => result.runtimeEvents)
    };
  }

  private defaultToolInput(name: string, input: unknown, context: ContextAssembly): unknown {
    const current = objectInput(input);

    if (name === 'channel.fetch_thread') {
      return {
        ...context.thread.ref,
        ...current,
        provider: context.thread.ref.provider,
        channelId: context.thread.ref.channelId,
        threadTs: context.thread.ref.threadTs
      };
    }

    if (name === 'user.get_preferences') {
      return {
        ...current,
        workspaceId: context.workspaceId,
        ...(context.targetUserId ? { userId: context.targetUserId } : {})
      };
    }

    if (name === 'memory.workspace.read') {
      return {
        ...current,
        workspaceId: context.workspaceId
      };
    }

    if (name === 'memory.thread.read') {
      return {
        ...current,
        workspaceId: context.workspaceId,
        channelId: context.thread.ref.channelId,
        threadTs: context.thread.ref.threadTs,
        ...(context.targetUserId ? { targetUserId: context.targetUserId } : {})
      };
    }

    return input;
  }

  private async enrichSearchResultForGrounding(
    name: string,
    output: unknown,
    context: ContextAssembly,
    workspace: Workspace,
    toolsUsed: string[],
    runtimeEvents: Array<{ type: RuntimeEventType; payload: unknown }>,
    postLoopEvidence: PostLoopEvidence
  ): Promise<unknown> {
    if (name === 'notion.read_page') {
      const artifact = notionPageArtifact(output);
      if (artifact) {
        postLoopEvidence.artifacts = mergeArtifacts(postLoopEvidence.artifacts, [artifact]);
      }
      return output;
    }

    if (
      name !== 'notion.search' ||
      !output ||
      typeof output !== 'object' ||
      !('results' in output) ||
      !Array.isArray(output.results) ||
      output.results.length === 0
    ) {
      return output;
    }

    const first = output.results[0];
    if (!first || typeof first !== 'object' || !('id' in first) || typeof first.id !== 'string') {
      return output;
    }

    if (
      !this.tools.has('notion.read_page') ||
      !context.memory.workspace.enabledOptionalTools.includes('notion.read_page')
    ) {
      return output;
    }

    const id = `auto-read:${first.id}`;
    runtimeEvents.push({
      type: 'agent.tool.requested',
      payload: {
        id,
        name: 'notion.read_page',
        reason: 'Auto-read first Notion search result for required grounding'
      }
    });

    try {
      const page = await this.tools.execute('notion.read_page', { pageId: first.id, maxBlocks: 40 }, {
        workspace,
        workspaceMemory: context.memory.workspace
      });
      toolsUsed.push('notion.read_page');

      if (page && typeof page === 'object' && 'url' in page && typeof page.url === 'string') {
        this.memory.linkThreadArtifact(
          workspace,
          context.thread.ref.channelId,
          context.thread.ref.threadTs,
          page.url,
          context.targetUserId
        );
        toolsUsed.push('memory.thread.link_artifact');
        postLoopEvidence.linkedArtifacts.push(page.url);
      }

      const artifact = notionPageArtifact(page);
      if (artifact) {
        postLoopEvidence.artifacts = mergeArtifacts(postLoopEvidence.artifacts, [artifact]);
      }

      runtimeEvents.push({
        type: 'agent.tool.completed',
        payload: { id, name: 'notion.read_page', ok: true, outputSummary: outputSummary(page) }
      });

      return {
        ...output,
        autoReadPage: page
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Tool execution failed';
      runtimeEvents.push({
        type: 'agent.tool.completed',
        payload: { id, name: 'notion.read_page', ok: false, error: message }
      });
      return output;
    }
  }
}
