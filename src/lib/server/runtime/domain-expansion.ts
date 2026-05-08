import type {
  ContextSource,
  ExpandedContextSourceNames,
  SkillManifest,
  WorkspaceMemory
} from '#lib/types';

function isOptionalContextSourceEnabled(source: Pick<ContextSource, 'name' | 'optional'>, workspaceMemory: WorkspaceMemory): boolean {
  return source.optional === false || source.name === 'memory.linked_artifacts' || workspaceMemory.enabledContextSources.includes(source.name);
}

function intersects(left: string[] = [], right: string[] = []): boolean {
  return left.some((value) => right.includes(value));
}

/**
 * Selects context sources to pre-fetch for a run. Context sources are NOT tools the
 * LLM picks — they are background retrievals attached to the prompt. Optional
 * prefetch is intent-relevant: enabled sources matching selected skill domains
 * are eligible, while other enabled tools remain model-callable as escape hatches.
 */
export function expandContextSources(input: {
  selectedSkills: SkillManifest[];
  allSources: Array<Pick<ContextSource, 'name' | 'optional' | 'knowledgeDomains'>>;
  workspaceMemory: WorkspaceMemory;
}): ExpandedContextSourceNames {
  const explicitNames = new Set(input.selectedSkills.flatMap((skill) => skill.contextSourceNames ?? []));
  const selectedDomains = [...new Set(input.selectedSkills.flatMap((skill) => skill.knowledgeDomains ?? []))];
  const explicit = new Set<string>();
  const optional = new Set<string>();

  for (const source of input.allSources) {
    if (explicitNames.has(source.name) && isOptionalContextSourceEnabled(source, input.workspaceMemory)) {
      explicit.add(source.name);
    }
  }

  for (const source of input.allSources) {
    if (
      !explicitNames.has(source.name) &&
      isOptionalContextSourceEnabled(source, input.workspaceMemory) &&
      intersects(source.knowledgeDomains ?? [], selectedDomains)
    ) {
      optional.add(source.name);
    }
  }

  return {
    explicit: [...explicit],
    optional: [...optional]
  };
}
