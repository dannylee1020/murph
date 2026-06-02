import { getGranolaService } from '#shared/server/context-sources/granola';
import {
  SOURCE_INDEX_SCHEMA_VERSION,
  type SourceIndexResource,
  writeSourceIndexResource
} from '../catalog.js';

interface GranolaIndexResult {
  resourceCount: number;
  changedPaths: string[];
  cursor?: string;
}

export async function indexGranolaSource(workspaceId: string, limit = 25): Promise<GranolaIndexResult> {
  const granola = getGranolaService();
  if (!granola.isConfigured()) {
    return { resourceCount: 0, changedPaths: [] };
  }

  const notes = (await granola.listRecentMeetings(limit)).results;
  const changedPaths: string[] = [];
  let cursor: string | undefined;
  for (const note of notes) {
    const resource: SourceIndexResource = {
      metadata: {
        schemaVersion: SOURCE_INDEX_SCHEMA_VERSION,
        provider: 'granola',
        workspaceId,
        resourceType: 'meeting_note',
        externalId: note.id,
        title: note.title,
        sourceUpdatedAt: note.scheduledStartTime,
        indexedAt: new Date().toISOString(),
        readTool: 'granola.read_meeting',
        readInput: { noteId: note.id },
        status: 'active',
        tags: ['granola', ...note.attendees.slice(0, 8)]
      },
      routingNotes: `Use this Granola meeting note for questions about "${note.title}", attendees, or meeting follow-up.`
    };
    const result = await writeSourceIndexResource(resource);
    changedPaths.push(result.relativePath);
    cursor = note.scheduledStartTime ?? cursor;
  }

  return { resourceCount: changedPaths.length, changedPaths, cursor };
}
