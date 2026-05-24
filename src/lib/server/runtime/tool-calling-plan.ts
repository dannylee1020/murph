import type {
  AgentToolInventoryItem,
  CompiledPolicy,
  ContextAssembly,
  SessionMode,
  ToolInventoryItem,
  WorkspaceMemory
} from '#lib/types';
import { buildGroundingDirective } from '#lib/server/runtime/skills-prompt';

export interface GroundingDirective {
  required: boolean;
  reason: string;
}

export interface RuntimeToolCallingPlan {
  availableTools: AgentToolInventoryItem[];
  retrievalToolNames: string[];
  fanoutTools: AgentToolInventoryItem[];
  groundingDirective: GroundingDirective;
}

export const RUNTIME_RETRIEVE_ALL_TOOL_NAME = 'runtime.retrieve_all';
export const MEMORY_WIKI_READ_PAGE_TOOL_NAME = 'memory.wiki.read_page';

const RUNTIME_RETRIEVE_ALL_TOOL: AgentToolInventoryItem = {
  name: RUNTIME_RETRIEVE_ALL_TOOL_NAME,
  description: 'Evaluate the current trigger as relevant, then run all enabled retrieval/search tools in parallel for grounding.',
  sideEffectClass: 'read',
  retrievalEligible: true,
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['requestFocus'],
    properties: {
      requestFocus: {
        type: 'string',
        description: 'A concise search query for the current request, excluding mentions and unrelated history.'
      }
    }
  }
};

function dedupeTools(tools: Array<AgentToolInventoryItem | ToolInventoryItem>): AgentToolInventoryItem[] {
  const byName = new Map<string, AgentToolInventoryItem>();

  for (const tool of tools) {
    if (!byName.has(tool.name)) {
      byName.set(tool.name, {
        name: tool.name,
        description: tool.description,
        sideEffectClass: tool.sideEffectClass,
        inputSchema: tool.inputSchema,
        knowledgeDomains: tool.knowledgeDomains,
        retrievalEligible: tool.retrievalEligible,
        retrieval: tool.retrieval
      });
    }
  }

  return [...byName.values()];
}

function isOptionalToolEnabled(tool: ToolInventoryItem, workspaceMemory: WorkspaceMemory): boolean {
  return !tool.requiresWorkspaceEnablement || workspaceMemory.enabledOptionalTools.includes(tool.name);
}

function isRetrievalTool(tool: ToolInventoryItem): boolean {
  return tool.sideEffectClass === 'read' && tool.retrievalEligible === true;
}

function sessionModeAllowsTool(tool: ToolInventoryItem, sessionMode?: SessionMode): boolean {
  if (!sessionMode) {
    return true;
  }
  if (!tool.sessionModes || tool.sessionModes.length === 0) {
    return true;
  }
  return tool.sessionModes.includes(sessionMode);
}

function isSourceArtifact(artifact: ContextAssembly['artifacts'][number]): boolean {
  return artifact.source !== 'memory.linked_artifacts' && artifact.source !== 'memory.tool_wiki.index';
}

function hasMemoryIndexArtifact(context: ContextAssembly): boolean {
  return context.artifacts.some((artifact) => artifact.source === 'memory.tool_wiki.index');
}

function requiresFreshRetrieval(context: ContextAssembly): boolean {
  return /\b(latest|current|currently|today|now|status|source[- ]of[- ]truth|fresh|changed|update|go\/no-go)\b/i
    .test(context.thread.latestMessage);
}

/**
 * Lists every tool the agent is allowed to see for this run, gated only by:
 *   - workspace allowlist (`enabledOptionalTools`)
 *   - session-mode policy
 *
 * No skill-driven filtering, no lexical question classification. The LLM picks
 * from this inventory using its native tool-calling mechanism.
 */
export function listAvailableTools(input: {
  allTools: ToolInventoryItem[];
  workspaceMemory: WorkspaceMemory;
  sessionMode?: SessionMode;
}): { availableTools: AgentToolInventoryItem[]; retrievalToolNames: string[] } {
  const allowed = input.allTools.filter(
    (tool) => isOptionalToolEnabled(tool, input.workspaceMemory) && sessionModeAllowsTool(tool, input.sessionMode)
  );
  const availableTools = dedupeTools(allowed);
  const retrievalToolNames = allowed.filter(isRetrievalTool).map((tool) => tool.name);
  return { availableTools, retrievalToolNames };
}

/**
 * Builds the full tool-calling plan for a run: available tools, retrieval-eligible
 * subset, and a skill-derived grounding directive that the prompt builder can render.
 *
 * The runtime safety net (defer when grounding was required but no retrieval was
 * attempted) reads `groundingDirective.required`.
 */
export function buildRuntimeToolCallingPlan(input: {
  context: ContextAssembly;
  allTools: ToolInventoryItem[];
  sessionMode?: SessionMode;
  policy?: CompiledPolicy;
}): RuntimeToolCallingPlan {
  const { availableTools, retrievalToolNames } = listAvailableTools({
    allTools: input.allTools,
    workspaceMemory: input.context.memory.workspace,
    sessionMode: input.sessionMode
  });
  const fanoutTools = availableTools.filter((tool) => retrievalToolNames.includes(tool.name));
  const memoryReadTool = availableTools.find((tool) => tool.name === MEMORY_WIKI_READ_PAGE_TOOL_NAME);
  const exposeMemoryRead = Boolean(memoryReadTool && hasMemoryIndexArtifact(input.context) && !requiresFreshRetrieval(input.context));
  const modelTools = [
    ...(fanoutTools.length > 0 ? [RUNTIME_RETRIEVE_ALL_TOOL] : []),
    ...(exposeMemoryRead && memoryReadTool ? [memoryReadTool] : [])
  ];
  const hasSourceArtifacts = input.context.artifacts.some(isSourceArtifact);
  const groundingDirective = input.policy?.requireGroundingForFacts && !hasSourceArtifacts
    ? {
        required: true,
        reason: 'Runtime grounding configuration requires retrieval before drafting factual replies because no current-run source evidence is present.'
      }
    : buildGroundingDirective({
        skills: input.context.skills,
        hasSourceArtifacts
      });

  return {
    availableTools: modelTools,
    retrievalToolNames: [
      ...modelTools
        .filter((tool) => tool.name === RUNTIME_RETRIEVE_ALL_TOOL_NAME || tool.name === MEMORY_WIKI_READ_PAGE_TOOL_NAME)
        .map((tool) => tool.name)
    ],
    fanoutTools,
    groundingDirective
  };
}
