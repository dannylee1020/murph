import { getNotionService } from '#app/server/context-sources/notion';
import {
  SOURCE_INDEX_SCHEMA_VERSION,
  type SourceIndexResource,
  writeSourceIndexResource
} from '../catalog.js';

interface NotionIndexResult {
  resourceCount: number;
  changedPaths: string[];
  cursor?: string;
}

export async function indexNotionSource(workspaceId: string, limit = 25): Promise<NotionIndexResult> {
  const notion = getNotionService();
  if (!notion.isConfigured(workspaceId)) {
    return { resourceCount: 0, changedPaths: [] };
  }

  const pages = await notion.listRecentPages(limit, workspaceId);
  const changedPaths: string[] = [];
  let cursor: string | undefined;
  for (const page of pages) {
    const resource: SourceIndexResource = {
      metadata: {
        schemaVersion: SOURCE_INDEX_SCHEMA_VERSION,
        provider: 'notion',
        workspaceId,
        resourceType: 'page',
        externalId: page.id,
        title: page.title,
        url: page.url,
        sourceUpdatedAt: page.updatedAt,
        indexedAt: new Date().toISOString(),
        readTool: 'notion.read_page',
        readInput: { pageId: page.id, maxBlocks: 40 },
        status: 'active',
        summaryStatus: 'missing',
        tags: ['notion', page.object]
      },
      routingNotes: `Use this Notion page for questions about "${page.title}" or related documentation.`
    };
    const result = await writeSourceIndexResource(resource);
    changedPaths.push(result.relativePath);
    cursor = page.updatedAt ?? cursor;
  }

  return { resourceCount: changedPaths.length, changedPaths, cursor };
}
