import { randomUUID } from 'node:crypto';
import type { FeedbackRecord, ThreadMemory, UserMemory, WorkspaceMemory } from '#lib/types';
import type { Db } from './_shared.js';
import { parseJsonObject } from './_shared.js';
import { getUser } from './user.js';

export function getOrCreateUserMemory(db: Db, workspaceId: string, userId: string): UserMemory {
  const row = db
    .prepare(`SELECT data_json FROM user_memory_v2 WHERE workspace_id = ? AND user_id = ?`)
    .get(workspaceId, userId) as { data_json: string } | undefined;

  if (row) {
    return parseJsonObject<UserMemory>(row.data_json, {
      userId,
      preferences: [],
      forbiddenTopics: [],
      routingHints: []
    });
  }

  const user = getUser(db, workspaceId, userId);
  const memory: UserMemory = {
    userId,
    preferences: [],
    fallbackUserId: user?.fallbackExternalUserId,
    forbiddenTopics: [],
    routingHints: []
  };

  db.prepare(`INSERT INTO user_memory_v2 (workspace_id, user_id, data_json) VALUES (?, ?, ?)`).run(
    workspaceId,
    userId,
    JSON.stringify(memory)
  );

  return memory;
}

export function upsertUserMemory(
  db: Db,
  workspaceId: string,
  userId: string,
  memory: UserMemory
): void {
  db.prepare(
    `INSERT INTO user_memory_v2 (workspace_id, user_id, data_json)
     VALUES (?, ?, ?)
     ON CONFLICT(workspace_id, user_id) DO UPDATE SET
       data_json = excluded.data_json`
  ).run(workspaceId, userId, JSON.stringify(memory));
}

export function getOrCreateWorkspaceMemory(db: Db, workspaceId: string): WorkspaceMemory {
  const row = db
    .prepare(`SELECT data_json FROM workspace_memory WHERE workspace_id = ?`)
    .get(workspaceId) as { data_json: string } | undefined;

  if (row) {
    return parseJsonObject<WorkspaceMemory>(row.data_json, {
      workspaceId,
      channelMappings: [],
      escalationRules: [],
      enabledOptionalTools: [],
      enabledContextSources: [],
      enabledPlugins: [],
      defaultPolicyProfileName: undefined
    });
  }

  const memory: WorkspaceMemory = {
    workspaceId,
    channelMappings: [],
    escalationRules: [],
    enabledOptionalTools: [],
    enabledContextSources: [],
    enabledPlugins: [],
    defaultPolicyProfileName: undefined
  };

  db.prepare(`INSERT INTO workspace_memory (workspace_id, data_json) VALUES (?, ?)`).run(
    workspaceId,
    JSON.stringify(memory)
  );

  return memory;
}

export function upsertWorkspaceMemory(db: Db, memory: WorkspaceMemory): void {
  db.prepare(
    `INSERT INTO workspace_memory (workspace_id, data_json)
     VALUES (?, ?)
     ON CONFLICT(workspace_id) DO UPDATE SET
       data_json = excluded.data_json`
  ).run(memory.workspaceId, JSON.stringify(memory));
}

export function getOrCreateThreadMemory(
  db: Db,
  workspaceId: string,
  channelId: string,
  threadTs: string
): ThreadMemory {
  const row = db
    .prepare(
      `SELECT data_json FROM thread_memory WHERE workspace_id = ? AND channel_id = ? AND thread_ts = ?`
    )
    .get(workspaceId, channelId, threadTs) as { data_json: string } | undefined;

  if (row) {
    return parseJsonObject<ThreadMemory>(row.data_json, {
      workspaceId,
      channelId,
      threadTs,
      linkedArtifacts: [],
      openQuestions: [],
      blockerNotes: []
    });
  }

  const memory: ThreadMemory = {
    workspaceId,
    channelId,
    threadTs,
    linkedArtifacts: [],
    openQuestions: [],
    blockerNotes: []
  };

  upsertThreadMemory(db, memory);
  return memory;
}

export function upsertThreadMemory(db: Db, memory: ThreadMemory): void {
  db.prepare(
    `INSERT INTO thread_memory (workspace_id, channel_id, thread_ts, data_json)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(workspace_id, channel_id, thread_ts) DO UPDATE SET
       data_json = excluded.data_json`
  ).run(memory.workspaceId, memory.channelId, memory.threadTs, JSON.stringify(memory));
}

export function insertFeedback(
  db: Db,
  input: Omit<FeedbackRecord, 'id' | 'createdAt'>
): FeedbackRecord {
  const record: FeedbackRecord = {
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    ...input
  };

  db.prepare(
    `INSERT INTO feedback_memory (
      id, workspace_id, session_id, thread_ts, original_action, final_action, note, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    record.id,
    record.workspaceId,
    record.sessionId ?? null,
    record.threadTs,
    record.originalAction,
    record.finalAction,
    record.note,
    record.createdAt
  );

  return record;
}
