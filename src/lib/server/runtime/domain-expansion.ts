import type {
  AgentToolInventoryItem,
  ContextSource,
  SkillManifest,
  ToolInventoryItem,
  WorkspaceMemory
} from '#lib/types';

function skillDomains(skills: SkillManifest[]): Set<string> {
  return new Set(skills.flatMap((skill) => skill.knowledgeDomains ?? []));
}

function isOptionalToolEnabled(tool: ToolInventoryItem, workspaceMemory: WorkspaceMemory): boolean {
  return !tool.requiresWorkspaceEnablement || workspaceMemory.enabledOptionalTools.includes(tool.name);
}

function isOptionalContextSourceEnabled(source: Pick<ContextSource, 'name' | 'optional'>, workspaceMemory: WorkspaceMemory): boolean {
  return source.optional === false || source.name === 'memory.linked_artifacts' || workspaceMemory.enabledContextSources.includes(source.name);
}

function intersects(values: string[] | undefined, domains: Set<string>): boolean {
  return Boolean(values?.some((value) => domains.has(value)));
}

const PRELOADED_CONTEXT_TOOLS = new Set([
  'channel.fetch_thread',
  'user.get_preferences',
  'memory.workspace.read',
  'memory.thread.read'
]);

export function expandToolsByDomain(input: {
  selectedSkills: SkillManifest[];
  allTools: ToolInventoryItem[];
  workspaceMemory: WorkspaceMemory;
}): AgentToolInventoryItem[] {
  const explicitNames = new Set(input.selectedSkills.flatMap((skill) => skill.toolNames));
  const domains = skillDomains(input.selectedSkills);
  const domainTools = input.allTools.filter(
    (tool) =>
      !explicitNames.has(tool.name) &&
      tool.sideEffectClass === 'read' &&
      intersects(tool.knowledgeDomains, domains) &&
      isOptionalToolEnabled(tool, input.workspaceMemory)
  );
  const explicitTools = input.allTools.filter((tool) => {
    if (!explicitNames.has(tool.name)) {
      return false;
    }

    return domainTools.length === 0 || !PRELOADED_CONTEXT_TOOLS.has(tool.name);
  });

  return [...domainTools, ...explicitTools]
    .filter((tool) => tool.sideEffectClass === 'read')
    .filter((tool) => isOptionalToolEnabled(tool, input.workspaceMemory))
    .map((tool) => ({
      name: tool.name,
      description: tool.description,
      sideEffectClass: tool.sideEffectClass,
      inputSchema: tool.inputSchema,
      knowledgeDomains: tool.knowledgeDomains
    }));
}

export function expandContextSourcesByDomain(input: {
  selectedSkills: SkillManifest[];
  allSources: Array<Pick<ContextSource, 'name' | 'optional' | 'knowledgeDomains'>>;
  workspaceMemory: WorkspaceMemory;
}): string[] {
  const explicitNames = new Set(input.selectedSkills.flatMap((skill) => skill.contextSourceNames ?? []));
  const domains = skillDomains(input.selectedSkills);
  const names = new Set<string>();

  for (const source of input.allSources) {
    if (explicitNames.has(source.name) && isOptionalContextSourceEnabled(source, input.workspaceMemory)) {
      names.add(source.name);
    }
  }

  for (const source of input.allSources) {
    if (
      !explicitNames.has(source.name) &&
      intersects(source.knowledgeDomains, domains) &&
      isOptionalContextSourceEnabled(source, input.workspaceMemory)
    ) {
      names.add(source.name);
    }
  }

  return [...names];
}

export function domainExpansionMap(input: {
  selectedSkills: SkillManifest[];
  availableTools: AgentToolInventoryItem[];
}): Record<string, string[]> {
  const explicitNames = new Set(input.selectedSkills.flatMap((skill) => skill.toolNames));
  const domains = skillDomains(input.selectedSkills);
  const expansion: Record<string, string[]> = {};

  for (const domain of domains) {
    const names = input.availableTools
      .filter((tool) => !explicitNames.has(tool.name))
      .filter((tool) => tool.knowledgeDomains?.includes(domain))
      .map((tool) => tool.name);

    if (names.length > 0) {
      expansion[domain] = names;
    }
  }

  return expansion;
}
