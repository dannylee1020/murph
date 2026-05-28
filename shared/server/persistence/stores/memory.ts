import type { ThreadMemory, UserMemory, WorkspaceMemory } from '#shared/types';
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
      confirmedChannels: []
    });
  }

  const memory: WorkspaceMemory = {
    workspaceId,
    channelMappings: [],
    escalationRules: [],
    enabledOptionalTools: [],
    enabledContextSources: [],
    enabledPlugins: [],
    confirmedChannels: []
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
  threadTs: string,
  targetUserId?: string
): ThreadMemory {
  const existing = getThreadMemory(db, workspaceId, channelId, threadTs, targetUserId);
  if (existing) {
    return existing;
  }

  const memory: ThreadMemory = {
    workspaceId,
    channelId,
    threadTs,
    targetUserId,
    linkedArtifacts: [],
    openQuestions: [],
    blockerNotes: []
  };

  upsertThreadMemory(db, memory);
  return memory;
}

export function getThreadMemory(
  db: Db,
  workspaceId: string,
  channelId: string,
  threadTs: string,
  targetUserId?: string
): ThreadMemory | undefined {
  const rowTargetUserId = targetUserId ?? '';
  const row = db
    .prepare(
      `SELECT target_user_id, data_json FROM thread_memory
       WHERE workspace_id = ? AND channel_id = ? AND thread_ts = ? AND target_user_id = ?`
    )
    .get(workspaceId, channelId, threadTs, rowTargetUserId) as { target_user_id: string; data_json: string } | undefined;

  if (row) {
    const parsed = parseJsonObject<ThreadMemory>(row.data_json, {
      workspaceId,
      channelId,
      threadTs,
      targetUserId,
      linkedArtifacts: [],
      openQuestions: [],
      blockerNotes: []
    });
    return {
      ...parsed,
      workspaceId,
      channelId,
      threadTs,
      targetUserId: row.target_user_id || parsed.targetUserId
    };
  }
  return undefined;
}

export function upsertThreadMemory(db: Db, memory: ThreadMemory): void {
  const targetUserId = memory.targetUserId ?? '';
  const data: ThreadMemory = {
    ...memory,
    targetUserId: memory.targetUserId || undefined
  };
  db.prepare(
    `INSERT INTO thread_memory (workspace_id, channel_id, thread_ts, target_user_id, data_json)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(workspace_id, channel_id, thread_ts, target_user_id) DO UPDATE SET
    data_json = excluded.data_json`
  ).run(memory.workspaceId, memory.channelId, memory.threadTs, targetUserId, JSON.stringify(data));
}
