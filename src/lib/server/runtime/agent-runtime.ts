import { getContextSourceRegistry } from '#lib/server/capabilities/context-source-registry';
import { getMemoryService } from '#lib/server/memory/service';
import { getModelProvider } from '#lib/server/providers/index';
import { runGroundingLoop } from '#lib/server/runtime/pi-agent-loop';
import { domainExpansionMap, expandContextSourcesByDomain, expandToolsByDomain } from '#lib/server/runtime/domain-expansion';
import { buildRuntimeToolCallingPlan } from '#lib/server/runtime/tool-calling-plan';
import { outputSummary, truncateToolOutput } from '#lib/server/runtime/tool-output';
import { selectSkills } from '#lib/server/skills/selection';
import { loadSkills } from '#lib/server/skills/loader';
import { getStore } from '#lib/server/persistence/store';
import { getToolRegistry } from '#lib/server/capabilities/tool-registry';
import type {
  AgentToolResult,
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
} from '#lib/types';

const MAX_TOOL_CALLS_PER_RUN = 6;

export interface AgentRunResult {
  context: ContextAssembly;
  proposedAction: ProposedAction;
  selectedSkillNames: string[];
  domainExpansion: Record<string, string[]>;
  toolsUsed: string[];
  toolResults: AgentToolResult[];
  runtimeEvents: Array<{ type: RuntimeEventType; payload: unknown }>;
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
  return toolResults.map((result) => ({
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

function requiresGrounding(context: ContextAssembly): boolean {
  return context.artifacts.length === 0 && context.skills.some((skill) => skill.groundingPolicy === 'required_when_no_artifacts');
}

export class AgentRuntime {
  private readonly store = getStore();
  private readonly memory = getMemoryService();
  private readonly tools = getToolRegistry();
  private readonly contextSources = getContextSourceRegistry();

  async run(task: ContinuityTask, session: AutopilotSession, workspace: Workspace): Promise<AgentRunResult> {
    const context = await this.buildContext(task, session, workspace);
    const { proposedAction, toolsUsed, toolResults, draft, runtimeEvents } = await this.proposeAction(context, workspace);
    const enrichedContext: ContextAssembly = {
      ...context,
      summary: draft.summary,
      unresolvedQuestions: draft.unresolvedQuestions,
      continuityCase: draft.continuityCase
    };

    return {
      context: enrichedContext,
      proposedAction,
      selectedSkillNames: enrichedContext.skills.map((skill) => skill.name),
      domainExpansion: domainExpansionMap({
        selectedSkills: enrichedContext.skills,
        availableTools: enrichedContext.availableTools
      }),
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
    const recentMessages = await this.tools.execute<
      { channelId: string; threadTs: string },
      ChannelMessage[]
    >('channel.fetch_thread', task.thread, { workspace, task });
    const latestMessage = recentMessages.at(-1)?.text ?? '';
    const userMemory = await this.tools.execute<{ workspaceId: string; slackUserId: string }, ContextAssembly['memory']['user']>(
      'user.get_preferences',
      {
        workspaceId: workspace.id,
        slackUserId: task.targetUserId
      },
      { workspace, task }
    );
    const workspaceMemory = await this.tools.execute<{ workspaceId: string }, ContextAssembly['memory']['workspace']>(
      'memory.workspace.read',
      { workspaceId: workspace.id },
      { workspace, task }
    );
    const threadMemory = await this.tools.execute<
      { workspaceId: string; channelId: string; threadTs: string },
      ContextAssembly['memory']['thread']
    >(
      'memory.thread.read',
      {
        workspaceId: workspace.id,
        channelId: task.thread.channelId,
        threadTs: task.thread.threadTs
      },
      { workspace, task }
    );
    const allSkills = await loadSkills();
    const allTools = this.tools.list();
    const selectedSkills = selectSkills({
      skills: allSkills,
      latestMessage,
      channel: task.thread.provider ?? 'slack',
      sessionMode: session.mode,
      tools: allTools,
      workspaceMemory,
      fallbackSkillName: 'channel-continuity',
      limit: 3
    });
    const availableTools = expandToolsByDomain({
      selectedSkills,
      allTools,
      workspaceMemory
    });
    const baseContext: Omit<ContextAssembly, 'artifacts' | 'summary' | 'unresolvedQuestions' | 'continuityCase'> = {
      workspaceId: workspace.id,
      task,
      targetUserId: task.targetUserId,
      thread: {
        ref: task.thread,
        latestMessage,
        recentMessages,
        participants: inferParticipants(recentMessages)
      },
      memory: {
        user: userMemory ?? this.memory.getUserMemory(workspace.id, task.targetUserId),
        workspace: workspaceMemory,
        thread: threadMemory
      },
      skills: selectedSkills,
      availableTools,
      linkedArtifacts: threadMemory.linkedArtifacts
    };
    const contextSourceNames = expandContextSourcesByDomain({
      selectedSkills,
      allSources: this.contextSources.list(),
      workspaceMemory
    });
    const artifacts = await this.contextSources.retrieve(contextSourceNames, {
      workspace,
      task,
      context: baseContext,
      enabledContextSources: workspaceMemory.enabledContextSources
    });

    return {
      ...baseContext,
      artifacts,
      availableTools: buildRuntimeToolCallingPlan({
        context: {
          ...baseContext,
          artifacts,
          continuityCase: inferCaseFromText(latestMessage),
          summary: latestMessage,
          unresolvedQuestions: latestMessage.includes('?') ? [latestMessage] : []
        },
        allTools
      }).availableTools,
      continuityCase: inferCaseFromText(latestMessage),
      summary: latestMessage,
      unresolvedQuestions: latestMessage.includes('?') ? [latestMessage] : []
    };
  }

  private async proposeAction(
    context: ContextAssembly,
    workspace: Workspace
  ): Promise<{
    draft: ProviderDraftResult;
    proposedAction: ProposedAction;
    toolsUsed: string[];
    toolResults: AgentToolResult[];
    runtimeEvents: Array<{ type: RuntimeEventType; payload: unknown }>;
  }> {
    const providerSettings = this.store.getProviderSettings(context.workspaceId);
    const provider = getModelProvider(providerSettings);
    const toolCallingPlan = buildRuntimeToolCallingPlan({
      context,
      allTools: this.tools.list()
    });

    try {
      const result = await runGroundingLoop({
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
        model: providerSettings?.model,
        maxToolCallsPerRun: MAX_TOOL_CALLS_PER_RUN,
        retrievalPlan: toolCallingPlan.retrievalPlan,
        retrievalToolNames: toolCallingPlan.retrievalToolNames,
        defaultToolInput: (name, input) => this.defaultToolInput(name, input, context),
        enrichToolOutput: async (name, output, toolsUsed, runtimeEvents) =>
          await this.enrichSearchResultForGrounding(name, output, context, workspace, toolsUsed, runtimeEvents),
        linkThreadArtifact: (url) => {
          this.memory.linkThreadArtifact(workspace, context.thread.ref.channelId, context.thread.ref.threadTs, url);
        }
      });
      const draft = toolCallingPlan.retrievalPlan.required && toolCallingPlan.retrievalToolNames.length > 0 && !result.retrievalAttempted
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
        proposedAction: { ...draft.proposedAction, toolsUsed: result.toolsUsed },
        toolsUsed: result.toolsUsed,
        toolResults: result.toolResults,
        runtimeEvents: result.runtimeEvents
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
          proposedAction: { ...draft.proposedAction, toolsUsed },
          toolsUsed,
          toolResults,
          runtimeEvents: [
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
          toolsUsed,
          toolResults,
          runtimeEvents: [
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

  private defaultToolInput(name: string, input: unknown, context: ContextAssembly): unknown {
    const current = objectInput(input);

    if (name === 'channel.fetch_thread') {
      return {
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
        slackUserId: context.targetUserId
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
        threadTs: context.thread.ref.threadTs
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
    runtimeEvents: Array<{ type: RuntimeEventType; payload: unknown }>
  ): Promise<unknown> {
    if (
      name !== 'notion.search' ||
      !requiresGrounding(context) ||
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

    if (!context.availableTools.some((tool) => tool.name === 'notion.read_page')) {
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
        this.memory.linkThreadArtifact(workspace, context.thread.ref.channelId, context.thread.ref.threadTs, page.url);
        toolsUsed.push('memory.thread.link_artifact');
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
