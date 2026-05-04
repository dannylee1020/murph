import type {
  ContextSource,
  ExpandedContextSourceNames,
  SkillManifest,
  WorkspaceMemory
} from '#lib/types';

function skillDomains(skills: SkillManifest[]): Set<string> {
  return new Set(skills.flatMap((skill) => skill.knowledgeDomains ?? []));
}

function isOptionalContextSourceEnabled(source: Pick<ContextSource, 'name' | 'optional'>, workspaceMemory: WorkspaceMemory): boolean {
  return source.optional === false || source.name === 'memory.linked_artifacts' || workspaceMemory.enabledContextSources.includes(source.name);
}

function intersects(values: string[] | undefined, domains: Set<string>): boolean {
  return Boolean(values?.some((value) => domains.has(value)));
}

/**
 * Selects context sources to pre-fetch for a run. Context sources are NOT tools the
 * LLM picks — they are background retrievals attached to the prompt. Selection here
 * still uses skill `knowledgeDomains` so we don't fetch unrelated sources every turn.
 */
export function expandContextSourcesByDomain(input: {
  selectedSkills: SkillManifest[];
  allSources: Array<Pick<ContextSource, 'name' | 'optional' | 'knowledgeDomains'>>;
  workspaceMemory: WorkspaceMemory;
}): ExpandedContextSourceNames {
  const explicitNames = new Set(input.selectedSkills.flatMap((skill) => skill.contextSourceNames ?? []));
  const domains = skillDomains(input.selectedSkills);
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
      intersects(source.knowledgeDomains, domains) &&
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
