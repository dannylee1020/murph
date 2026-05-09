import { getRuntimeEnv } from '#lib/server/util/env';
import { resolveCredential } from '#lib/server/integrations/credentials';
import type { ContextArtifact } from '#lib/types';

interface NotionSearchResponse {
  results?: NotionSearchResult[];
}

interface NotionSearchResult {
  object?: string;
  id: string;
  url?: string;
  public_url?: string | null;
  parent?: { type?: string; data_source_id?: string; database_id?: string; page_id?: string };
  properties?: Record<string, unknown>;
}

interface NotionBlockListResponse {
  results?: NotionBlock[];
  next_cursor?: string | null;
  has_more?: boolean;
}

interface NotionBlock {
  id: string;
  type?: string;
  has_children?: boolean;
  [key: string]: unknown;
}

export interface NotionSearchItem {
  id: string;
  title: string;
  url?: string;
  object: string;
}

export interface NotionSearchOutput {
  results: NotionSearchItem[];
  strategy: 'notion_api_search' | 'cached_zero_result';
}

export interface NotionPageText {
  id: string;
  title: string;
  url?: string;
  text: string;
}

function normalizeId(value: string): string {
  return value.replaceAll('-', '').toLowerCase();
}

function textFromRichText(value: unknown): string {
  if (!Array.isArray(value)) {
    return '';
  }

  return value
    .map((entry) => {
      if (entry && typeof entry === 'object' && 'plain_text' in entry) {
        return String(entry.plain_text ?? '');
      }
      return '';
    })
    .join('');
}

function titleFromProperties(properties: Record<string, unknown> | undefined): string {
  if (!properties) {
    return 'Untitled Notion page';
  }

  for (const property of Object.values(properties)) {
    if (!property || typeof property !== 'object') {
      continue;
    }

    if ('type' in property && property.type === 'title' && 'title' in property) {
      const title = textFromRichText(property.title);
      if (title) {
        return title;
      }
    }
  }

  return 'Untitled Notion page';
}

function blockText(block: NotionBlock): string {
  const type = block.type;

  if (!type) {
    return '';
  }

  const payload = block[type];

  if (!payload || typeof payload !== 'object') {
    return '';
  }

  if ('rich_text' in payload) {
    const text = textFromRichText(payload.rich_text);
    if (!text) {
      return '';
    }

    if (type === 'bulleted_list_item') {
      return `- ${text}`;
    }

    if (type === 'numbered_list_item') {
      return `1. ${text}`;
    }

    if (type === 'to_do') {
      const checked = 'checked' in payload && payload.checked ? 'x' : ' ';
      return `- [${checked}] ${text}`;
    }

    return text;
  }

  if (type === 'child_page' && 'title' in payload) {
    return String(payload.title ?? '');
  }

  if ((type === 'bookmark' || type === 'link_preview') && 'url' in payload) {
    return String(payload.url ?? '');
  }

  return '';
}

export function getNotionStatus(): {
  configured: boolean;
  version: string;
} {
  const env = getRuntimeEnv();
  return {
    configured: Boolean(env.notionApiKey),
    version: env.notionVersion
  };
}

export class NotionService {
  private readonly env = getRuntimeEnv();

  isConfigured(workspaceId?: string): boolean {
    return Boolean(resolveCredential(workspaceId, 'notion'));
  }

  async search(query: string, limit = this.env.notionMaxResults, workspaceId?: string): Promise<NotionSearchOutput> {
    const credential = resolveCredential(workspaceId, 'notion')?.value;
    if (!credential) {
      throw new Error('NOTION_API_KEY is required');
    }

    const apiResults = await this.searchByTitle(query, limit, credential);

    return {
      results: apiResults,
      strategy: 'notion_api_search'
    };
  }

  async readPage(pageId: string, maxBlocks = 40, workspaceId?: string): Promise<NotionPageText> {
    const credential = resolveCredential(workspaceId, 'notion')?.value;
    if (!credential) {
      throw new Error('NOTION_API_KEY is required');
    }

    const pageMeta = await this.readPageMeta(pageId, credential);
    const blocks = await this.readBlocks(pageId, maxBlocks, credential);
    const lines = blocks.map(blockText).filter(Boolean);

    return {
      id: pageId,
      title: pageMeta.title,
      url: pageMeta.url,
      text: lines.join('\n').slice(0, 6000)
    };
  }

  toArtifact(page: NotionPageText | NotionSearchItem, text?: string): ContextArtifact {
    return {
      id: `notion:${page.id}`,
      source: 'notion',
      type: 'document',
      title: page.title,
      text: text ?? ('text' in page ? page.text : page.title),
      url: page.url,
      metadata: { notionPageId: page.id }
    };
  }

  private async searchByTitle(query: string, limit: number, credential: string): Promise<NotionSearchItem[]> {
    const response = await fetch('https://api.notion.com/v1/search', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${credential}`,
        'content-type': 'application/json',
        'notion-version': this.env.notionVersion
      },
      body: JSON.stringify({
        query,
        page_size: Math.max(1, Math.min(limit, 10)),
        filter: { property: 'object', value: 'page' },
        sort: { direction: 'descending', timestamp: 'last_edited_time' }
      })
    });

    const payload = (await response.json().catch(() => ({}))) as NotionSearchResponse & { message?: string };

    if (!response.ok) {
      throw new Error(payload.message ?? `Notion search failed with ${response.status}`);
    }

    return (payload.results ?? [])
      .slice(0, limit)
      .map((result) => ({
        id: result.id,
        title: titleFromProperties(result.properties),
        url: result.public_url ?? result.url,
        object: result.object ?? 'page'
      }));
  }

  private async readPageMeta(pageId: string, credential: string): Promise<{ title: string; url?: string }> {
    const response = await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
      headers: {
        authorization: `Bearer ${credential}`,
        'notion-version': this.env.notionVersion
      }
    });
    const payload = (await response.json().catch(() => ({}))) as NotionSearchResult & { message?: string };

    if (!response.ok) {
      throw new Error(payload.message ?? `Notion page fetch failed with ${response.status}`);
    }

    return {
      title: titleFromProperties(payload.properties),
      url: payload.public_url ?? payload.url ?? `https://www.notion.so/${normalizeId(pageId)}`
    };
  }

  private async readBlocks(blockId: string, maxBlocks: number, credential: string): Promise<NotionBlock[]> {
    const blocks: NotionBlock[] = [];
    let cursor: string | undefined;

    while (blocks.length < maxBlocks) {
      const params = new URLSearchParams({ page_size: String(Math.min(100, maxBlocks - blocks.length)) });
      if (cursor) {
        params.set('start_cursor', cursor);
      }

      const response = await fetch(`https://api.notion.com/v1/blocks/${blockId}/children?${params.toString()}`, {
        headers: {
          authorization: `Bearer ${credential}`,
          'notion-version': this.env.notionVersion
        }
      });
      const payload = (await response.json().catch(() => ({}))) as NotionBlockListResponse & { message?: string };

      if (!response.ok) {
        throw new Error(payload.message ?? `Notion block read failed with ${response.status}`);
      }

      blocks.push(...(payload.results ?? []));

      if (!payload.has_more || !payload.next_cursor) {
        break;
      }

      cursor = payload.next_cursor;
    }

    return blocks;
  }
}

let notionService: NotionService | null = null;

export function getNotionService(): NotionService {
  if (!notionService) {
    notionService = new NotionService();
  }

  return notionService;
}
