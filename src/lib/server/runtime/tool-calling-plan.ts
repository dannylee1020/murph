import type { AgentToolInventoryItem, ContextAssembly, ToolInventoryItem, WorkspaceMemory } from '#lib/types';

export type RuntimeQuestionKind =
  | 'factual_status'
  | 'factual_lookup'
  | 'procedural'
  | 'coordination'
  | 'other';

export interface RuntimeRetrievalPlan {
  required: boolean;
  reason: string;
  questionKind: RuntimeQuestionKind;
  preferredDomains: string[];
  failureDisposition: 'queue_review' | 'ask_narrow_followup' | 'abstain';
}

export interface RuntimeToolCallingPlan {
  availableTools: AgentToolInventoryItem[];
  retrievalPlan: RuntimeRetrievalPlan;
  retrievalToolNames: string[];
}

const FACTUAL_STATUS_PATTERNS = [
  /\bstatus\b/i,
  /\bready(?:\s+to)?\s+(?:launch|ship|release)\b/i,
  /\bgo(?:-| )live\b/i,
  /\blaunch\b/i,
  /\brelease\b/i,
  /\bship\b/i,
  /\bdecision\b/i,
  /\bsignoff\b/i,
  /\bapproval\b/i,
  /\bsource of truth\b/i
];

const FACTUAL_LOOKUP_PATTERNS = [
  /\bwhat(?:'s| is)\b/i,
  /\bwhere\b/i,
  /\bwho owns\b/i,
  /\bblocked\b/i,
  /\blatest\b/i
];

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
  return tool.sideEffectClass === 'read' && Boolean(tool.knowledgeDomains?.length) && tool.retrievalEligible === true;
}

export function classifyRuntimeQuestion(context: ContextAssembly): RuntimeQuestionKind {
  const latest = context.thread.latestMessage;

  if (context.continuityCase === 'status_request' || FACTUAL_STATUS_PATTERNS.some((pattern) => pattern.test(latest))) {
    return 'factual_status';
  }

  if (FACTUAL_LOOKUP_PATTERNS.some((pattern) => pattern.test(latest))) {
    return 'factual_lookup';
  }

  if (/\bhow\b|\bsteps\b|\bprocess\b|\brunbook\b|\bplaybook\b/i.test(latest)) {
    return 'procedural';
  }

  if (/\bcan you\b|\bplease\b|\bfollow up\b|\bping\b|\brespond\b/i.test(latest)) {
    return 'coordination';
  }

  return 'other';
}

function currentContextSeemsSufficient(context: ContextAssembly, questionKind: RuntimeQuestionKind): boolean {
  if (context.artifacts.length > 0) {
    return true;
  }

  if (questionKind === 'coordination' && context.thread.recentMessages.length > 1) {
    return true;
  }

  return false;
}

function preferredDomains(context: ContextAssembly): string[] {
  const domains = new Set<string>(context.skills.flatMap((skill) => skill.knowledgeDomains ?? []));

  if (domains.size === 0) {
    domains.add('documentation');
  }

  return [...domains];
}

export function buildRuntimeToolCallingPlan(input: {
  context: ContextAssembly;
  allTools: ToolInventoryItem[];
}): RuntimeToolCallingPlan {
  const questionKind = classifyRuntimeQuestion(input.context);
  const preferred = preferredDomains(input.context);
  const needsRetrieval =
    (questionKind === 'factual_status' || questionKind === 'factual_lookup' || questionKind === 'procedural') &&
    !currentContextSeemsSufficient(input.context, questionKind);
  const retrievalTools = input.allTools.filter((tool) =>
    isRetrievalTool(tool) &&
    isOptionalToolEnabled(tool, input.context.memory.workspace) &&
    (preferred.length === 0 || tool.knowledgeDomains?.some((domain) => preferred.includes(domain)))
  );
  if (retrievalTools.length === 0) {
    const webSearch = input.allTools.find(
      (tool) => tool.name === 'web.search' && isRetrievalTool(tool) && isOptionalToolEnabled(tool, input.context.memory.workspace)
    );
    if (webSearch) {
      retrievalTools.push(webSearch);
    }
  }
  const retrievalPlan: RuntimeRetrievalPlan = needsRetrieval
    ? {
        required: retrievalTools.length > 0,
        reason: retrievalTools.length > 0
          ? 'Current context is insufficient for a factual answer; retrieval should be attempted before drafting.'
          : 'Current context is insufficient for a factual answer, but no retrieval tools are available for this workspace.',
        questionKind,
        preferredDomains: preferred,
        failureDisposition: 'queue_review'
      }
    : {
        required: false,
        reason: 'Current context appears sufficient, or the request is coordination-oriented rather than a factual lookup.',
        questionKind,
        preferredDomains: preferred,
        failureDisposition: 'ask_narrow_followup'
      };
  const availableTools = needsRetrieval
    ? dedupeTools([...input.context.availableTools, ...retrievalTools])
    : input.context.availableTools;

  return {
    availableTools,
    retrievalPlan,
    retrievalToolNames: retrievalTools.map((tool) => tool.name)
  };
}
