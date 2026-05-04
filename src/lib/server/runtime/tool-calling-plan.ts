import type {
  AgentToolInventoryItem,
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
  groundingDirective: GroundingDirective;
}

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
        retrievalEligible: tool.retrievalEligible
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
}): RuntimeToolCallingPlan {
  const { availableTools, retrievalToolNames } = listAvailableTools({
    allTools: input.allTools,
    workspaceMemory: input.context.memory.workspace,
    sessionMode: input.sessionMode
  });
  const groundingDirective = buildGroundingDirective({
    skills: input.context.skills,
    hasArtifacts: input.context.artifacts.length > 0
  });

  return {
    availableTools,
    retrievalToolNames,
    groundingDirective
  };
}
