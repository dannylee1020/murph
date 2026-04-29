import type {
  SessionMode,
  ToolDefinition,
  ToolExecutionContext,
  ToolInventoryItem,
  ToolSideEffectClass
} from '#lib/types';

interface RegisteredTool {
  definition: ToolDefinition<any, any>;
  source: string;
  optional: boolean;
}

export class ToolRegistry {
  private readonly tools = new Map<string, RegisteredTool>();

  register<TInput, TOutput>(
    tool: ToolDefinition<TInput, TOutput>,
    opts?: { optional?: boolean; source?: string }
  ): void {
    if (this.tools.has(tool.name)) {
      throw new Error(`Tool already registered: ${tool.name}`);
    }

    this.tools.set(tool.name, {
      definition: tool,
      optional: opts?.optional ?? tool.optional ?? false,
      source: opts?.source ?? 'core'
    });
  }

  get<TInput, TOutput>(name: string): ToolDefinition<TInput, TOutput> {
    const registered = this.tools.get(name);

    if (!registered) {
      throw new Error(`Unknown tool: ${name}`);
    }

    return registered.definition as ToolDefinition<TInput, TOutput>;
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  async execute<TInput, TOutput>(
    name: string,
    input: TInput,
    context: ToolExecutionContext
  ): Promise<TOutput> {
    const tool = this.get<TInput, TOutput>(name);
    const sessionMode = context.session?.mode;
    const enabledOptionalTools = context.workspaceMemory?.enabledOptionalTools ?? [];

    if (tool.sessionModes && sessionMode && !tool.sessionModes.includes(sessionMode as SessionMode)) {
      throw new Error(`Tool ${name} is not allowed in ${sessionMode} mode`);
    }

    if (tool.requiresWorkspaceEnablement && !enabledOptionalTools.includes(name)) {
      throw new Error(`Tool ${name} is not enabled for this workspace`);
    }

    if (sessionMode === 'dry_run' && tool.sideEffectClass !== 'read' && tool.supportsDryRun === false) {
      throw new Error(`Tool ${name} is blocked in dry-run mode`);
    }

    return await tool.execute(input, context);
  }

  list(): ToolInventoryItem[] {
    return [...this.tools.entries()].map(([name, registered]) => ({
      name,
      description: registered.definition.description,
      sideEffectClass: registered.definition.sideEffectClass as ToolSideEffectClass,
      inputSchema: registered.definition.inputSchema,
      knowledgeDomains: registered.definition.knowledgeDomains,
      retrievalEligible: registered.definition.retrievalEligible ?? false,
      optional: registered.optional,
      source: registered.source,
      sessionModes: registered.definition.sessionModes,
      requiresWorkspaceEnablement: registered.definition.requiresWorkspaceEnablement,
      supportsDryRun: registered.definition.supportsDryRun
    }));
  }
}

let registry: ToolRegistry | null = null;

export function getToolRegistry(): ToolRegistry {
  if (!registry) {
    registry = new ToolRegistry();
  }

  return registry;
}
