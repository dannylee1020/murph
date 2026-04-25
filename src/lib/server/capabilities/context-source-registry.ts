import type {
  ContextArtifact,
  ContextAssembly,
  ContextSource,
  ContinuityTask,
  Workspace
} from '#lib/types';

interface RegisteredContextSource {
  definition: ContextSource;
  optional: boolean;
  source: string;
}

export class ContextSourceRegistry {
  private readonly sources = new Map<string, RegisteredContextSource>();

  register(source: ContextSource, opts?: { optional?: boolean; source?: string }): void {
    if (this.sources.has(source.name)) {
      throw new Error(`Context source already registered: ${source.name}`);
    }

    this.sources.set(source.name, {
      definition: source,
      optional: opts?.optional ?? source.optional ?? true,
      source: opts?.source ?? 'core'
    });
  }

  async retrieve(
    names: string[],
    input: {
      workspace: Workspace;
      task: ContinuityTask;
      context: Omit<ContextAssembly, 'artifacts' | 'summary' | 'unresolvedQuestions' | 'continuityCase'>;
      enabledContextSources: string[];
    }
  ): Promise<ContextArtifact[]> {
    const requested = [...new Set(names)];
    const artifacts: ContextArtifact[] = [];

    for (const name of requested) {
      const registered = this.sources.get(name);

      if (!registered) {
        continue;
      }

      if (registered.optional && !input.enabledContextSources.includes(name)) {
        continue;
      }

      try {
        artifacts.push(...(await registered.definition.retrieve(input)));
      } catch {
        continue;
      }
    }

    return artifacts;
  }

  list() {
    return [...this.sources.values()].map((registered) => ({
      name: registered.definition.name,
      description: registered.definition.description,
      optional: registered.optional,
      knowledgeDomains: registered.definition.knowledgeDomains,
      source: registered.source
    }));
  }
}

let registry: ContextSourceRegistry | null = null;

export function getContextSourceRegistry(): ContextSourceRegistry {
  if (!registry) {
    registry = new ContextSourceRegistry();
  }

  return registry;
}
