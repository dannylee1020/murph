import type {
  ContextSource,
  ExpandedContextSourceNames,
  SkillManifest,
  WorkspaceMemory
} from '#lib/types';

function isOptionalContextSourceEnabled(source: Pick<ContextSource, 'name' | 'optional'>, workspaceMemory: WorkspaceMemory): boolean {
  return source.optional === false || source.name === 'memory.linked_artifacts' || workspaceMemory.enabledContextSources.includes(source.name);
}

/**
 * Selects context sources to pre-fetch for a run. Context sources are NOT tools the
 * LLM picks — they are background retrievals attached to the prompt. All enabled
 * optional sources are eligible; the registry applies the configured optional cap.
 */
export function expandContextSources(input: {
  selectedSkills: SkillManifest[];
  allSources: Array<Pick<ContextSource, 'name' | 'optional' | 'knowledgeDomains'>>;
  workspaceMemory: WorkspaceMemory;
}): ExpandedContextSourceNames {
  const explicitNames = new Set(input.selectedSkills.flatMap((skill) => skill.contextSourceNames ?? []));
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
      isOptionalContextSourceEnabled(source, input.workspaceMemory)
    ) {
      optional.add(source.name);
    }
  }

  return {
    explicit: [...explicit],
    optional: [...optional]
  };
}
