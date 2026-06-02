import { getLinearService } from '#shared/server/context-sources/linear';
import {
  SOURCE_INDEX_SCHEMA_VERSION,
  type SourceIndexResource,
  writeSourceIndexResource
} from '../catalog.js';

interface LinearIndexResult {
  resourceCount: number;
  changedPaths: string[];
  cursor?: string;
}

export async function indexLinearSource(workspaceId: string, limit = 25): Promise<LinearIndexResult> {
  const linear = getLinearService();
  if (!linear.isConfigured(workspaceId)) {
    return { resourceCount: 0, changedPaths: [] };
  }

  const issues = (await linear.listRecentIssues(limit, workspaceId)).results;
  const changedPaths: string[] = [];
  let cursor: string | undefined;
  for (const issue of issues) {
    const resource: SourceIndexResource = {
      metadata: {
        schemaVersion: SOURCE_INDEX_SCHEMA_VERSION,
        provider: 'linear',
        workspaceId,
        resourceType: 'issue',
        externalId: issue.id,
        title: `${issue.identifier} ${issue.title}`,
        url: issue.url,
        sourceUpdatedAt: issue.updatedAt,
        indexedAt: new Date().toISOString(),
        scope: issue.team,
        readTool: 'linear.read_issue',
        readInput: { issueId: issue.id },
        status: 'active',
        tags: ['linear', issue.identifier, issue.state ?? 'unknown', issue.team ?? '', issue.project ?? ''].filter(Boolean)
      },
      routingNotes: `Use this Linear issue for questions about ${issue.identifier}, "${issue.title}", ${issue.state ?? 'unknown'} work, or ${issue.project ?? issue.team ?? 'related'} planning.`
    };
    const result = await writeSourceIndexResource(resource);
    changedPaths.push(result.relativePath);
    cursor = issue.updatedAt ?? cursor;
  }

  return { resourceCount: changedPaths.length, changedPaths, cursor };
}
