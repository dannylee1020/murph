import type {
  ContextArtifact,
  ContextAssembly,
  ContextSource,
  ContinuityTask,
  Workspace
} from '#app/types';
import { getRuntimeEnv } from '#app/server/util/env';

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

  has(name: string): boolean {
    return this.sources.has(name);
  }

  unregister(name: string): void {
    this.sources.delete(name);
  }

  async retrieve(
    explicitNames: string[],
    optionalNames: string[],
    input: {
      workspace: Workspace;
      task: ContinuityTask;
      context: Omit<ContextAssembly, 'artifacts' | 'summary' | 'unresolvedQuestions' | 'continuityCase'>;
      enabledContextSources: string[];
      maxOptionalSources?: number;
    }
  ): Promise<ContextArtifact[]> {
    const env = getRuntimeEnv();
    const requestedExplicit = [...new Set(explicitNames)];
    const maxOptionalSources = input.maxOptionalSources ?? env.contextSourceMaxOptional;
    const requestedOptional = [...new Set(optionalNames)].slice(0, Math.max(0, maxOptionalSources));
    const requestedNames = [...requestedExplicit, ...requestedOptional];

    const results = await Promise.all(requestedNames.map(async (name) => {
      const registered = this.sources.get(name);

      if (!registered) {
        return [];
      }

      if (registered.optional && !input.enabledContextSources.includes(name)) {
        return [];
      }

      let timeout: ReturnType<typeof setTimeout> | undefined;
      try {
        const result = await Promise.race([
          registered.definition.retrieve(input),
          new Promise<ContextArtifact[]>((_, reject) => {
            timeout = setTimeout(
              () => reject(new Error(`Context source timed out: ${name}`)),
              env.contextSourceTimeoutMs
            );
          })
        ]);
        if (timeout) {
          clearTimeout(timeout);
        }
        return result;
      } catch {
        return [];
      } finally {
        if (timeout) {
          clearTimeout(timeout);
        }
      }
    }));

    return results.flat();
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
