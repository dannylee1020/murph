import type {
  ContextArtifact,
  ContextAssembly,
  ContextSource,
  ContinuityTask,
  Workspace
} from '#lib/types';
import { getRuntimeEnv } from '#lib/server/util/env';

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
    explicitNames: string[],
    optionalNames: string[],
    input: {
      workspace: Workspace;
      task: ContinuityTask;
      context: Omit<ContextAssembly, 'artifacts' | 'summary' | 'unresolvedQuestions' | 'continuityCase'>;
      enabledContextSources: string[];
    }
  ): Promise<ContextArtifact[]> {
    const env = getRuntimeEnv();
    const requestedExplicit = [...new Set(explicitNames)];
    const requestedOptional = [...new Set(optionalNames)].slice(0, Math.max(0, env.contextSourceMaxOptional));
    const artifacts: ContextArtifact[] = [];

    for (const name of [...requestedExplicit, ...requestedOptional]) {
      const registered = this.sources.get(name);

      if (!registered) {
        continue;
      }

      if (registered.optional && !input.enabledContextSources.includes(name)) {
        continue;
      }

      try {
        const result = await Promise.race([
          registered.definition.retrieve(input),
          new Promise<ContextArtifact[]>((_, reject) =>
            setTimeout(() => reject(new Error(`Context source timed out: ${name}`)), env.contextSourceTimeoutMs)
          )
        ]);
        artifacts.push(...result);
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
