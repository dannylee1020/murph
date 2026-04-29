import { getRuntimeEnv } from '#lib/server/util/env';
import type { ToolDefinition } from '#lib/types';

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

interface WebSearchBackend {
  readonly name: 'tavily' | 'brave';
  search(query: string, opts: { limit: number }): Promise<SearchResult[]>;
}

class TavilyBackend implements WebSearchBackend {
  readonly name = 'tavily' as const;

  async search(query: string, opts: { limit: number }): Promise<SearchResult[]> {
    const { tavilyApiKey } = getRuntimeEnv();

    if (!tavilyApiKey) {
      throw new Error('TAVILY_API_KEY is not configured');
    }

    const response = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        api_key: tavilyApiKey,
        query,
        max_results: opts.limit,
        search_depth: 'basic',
        include_answer: false,
        include_raw_content: false
      })
    });
    const payload = await response.json().catch(() => ({})) as {
      results?: Array<{ title?: string; url?: string; content?: string }>;
      error?: string;
    };

    if (!response.ok) {
      throw new Error(payload.error ?? `Tavily search failed with ${response.status}`);
    }

    return (payload.results ?? [])
      .filter((result) => result.url)
      .map((result) => ({
        title: result.title?.trim() || result.url || 'Untitled result',
        url: result.url!,
        snippet: result.content?.trim() || ''
      }));
  }
}

class BraveBackend implements WebSearchBackend {
  readonly name = 'brave' as const;

  async search(query: string, opts: { limit: number }): Promise<SearchResult[]> {
    const { braveSearchApiKey } = getRuntimeEnv();

    if (!braveSearchApiKey) {
      throw new Error('BRAVE_SEARCH_API_KEY is not configured');
    }

    const url = new URL('https://api.search.brave.com/res/v1/web/search');
    url.searchParams.set('q', query);
    url.searchParams.set('count', String(opts.limit));
    const response = await fetch(url, {
      headers: {
        Accept: 'application/json',
        'X-Subscription-Token': braveSearchApiKey
      }
    });
    const payload = await response.json().catch(() => ({})) as {
      web?: { results?: Array<{ title?: string; url?: string; description?: string }> };
      error?: { detail?: string };
    };

    if (!response.ok) {
      throw new Error(payload.error?.detail ?? `Brave search failed with ${response.status}`);
    }

    return (payload.web?.results ?? [])
      .filter((result) => result.url)
      .map((result) => ({
        title: result.title?.trim() || result.url || 'Untitled result',
        url: result.url!,
        snippet: result.description?.trim() || ''
      }));
  }
}

function getBackend(): WebSearchBackend {
  const env = getRuntimeEnv();
  return env.webSearchBackend === 'brave' ? new BraveBackend() : new TavilyBackend();
}

export function createWebSearchTool(): ToolDefinition<{ query: string; limit?: number }, { backend: string; query: string; results: SearchResult[] }> {
  return {
    name: 'web.search',
    description: 'Search the public web for recent factual information.',
    sideEffectClass: 'read',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['query'],
      properties: {
        query: { type: 'string' },
        limit: { type: 'number' }
      }
    },
    knowledgeDomains: ['web'],
    retrievalEligible: true,
    optional: true,
    requiresWorkspaceEnablement: true,
    supportsDryRun: true,
    async execute(input) {
      const backend = getBackend();
      const limit = Math.max(1, Math.min(input.limit ?? 5, 10));

      return {
        backend: backend.name,
        query: input.query,
        results: await backend.search(input.query, { limit })
      };
    }
  };
}
