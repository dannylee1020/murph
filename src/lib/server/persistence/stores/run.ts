import { randomUUID } from 'node:crypto';
import type {
  AgentRunEventRecord,
  AgentRunRecord,
  AgentRunStatus,
  AgentRunSummary
} from '#lib/types';
import type { Db } from './_shared.js';
import { parseJsonObject } from './_shared.js';

export interface CreateAgentRunInput {
  workspaceId: string;
  sessionId?: string;
  taskId: string;
  channelId: string;
  threadTs: string;
  targetUserId: string;
}

export interface AppendAgentRunEventInput {
  runId: string;
  type: AgentRunEventRecord['type'];
  payload: unknown;
}

interface RunRow {
  id: string;
  workspace_id: string;
  session_id?: string;
  task_id: string;
  channel_id: string;
  thread_ts: string;
  target_user_id: string;
  status: AgentRunStatus;
  started_at: string;
  completed_at?: string;
}

function mapRun(row: RunRow): AgentRunRecord {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    sessionId: row.session_id,
    taskId: row.task_id,
    channelId: row.channel_id,
    threadTs: row.thread_ts,
    targetUserId: row.target_user_id,
    status: row.status,
    startedAt: row.started_at,
    completedAt: row.completed_at
  };
}

export function createAgentRun(db: Db, input: CreateAgentRunInput): AgentRunRecord {
  const run: AgentRunRecord = {
    id: randomUUID(),
    workspaceId: input.workspaceId,
    sessionId: input.sessionId,
    taskId: input.taskId,
    channelId: input.channelId,
    threadTs: input.threadTs,
    targetUserId: input.targetUserId,
    status: 'running',
    startedAt: new Date().toISOString()
  };

  db.prepare(
    `INSERT INTO agent_runs (
      id, workspace_id, session_id, task_id, channel_id, thread_ts, target_user_id, status, started_at, completed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    run.id,
    run.workspaceId,
    run.sessionId ?? null,
    run.taskId,
    run.channelId,
    run.threadTs,
    run.targetUserId,
    run.status,
    run.startedAt,
    null
  );

  return run;
}

export function finishAgentRun(
  db: Db,
  id: string,
  status: Exclude<AgentRunStatus, 'running'>
): AgentRunRecord | undefined {
  const completedAt = new Date().toISOString();
  db.prepare(`UPDATE agent_runs SET status = ?, completed_at = ? WHERE id = ?`).run(
    status,
    completedAt,
    id
  );
  return getAgentRun(db, id);
}

export function getAgentRun(db: Db, id: string): AgentRunRecord | undefined {
  const row = db.prepare(`SELECT * FROM agent_runs WHERE id = ?`).get(id) as RunRow | undefined;
  return row ? mapRun(row) : undefined;
}

export function appendAgentRunEvent(db: Db, input: AppendAgentRunEventInput): AgentRunEventRecord {
  const sequenceRow = db
    .prepare(
      `SELECT COALESCE(MAX(sequence), 0) + 1 as next_sequence FROM agent_run_events WHERE run_id = ?`
    )
    .get(input.runId) as { next_sequence: number };
  const event: AgentRunEventRecord = {
    id: randomUUID(),
    runId: input.runId,
    sequence: sequenceRow.next_sequence,
    type: input.type,
    payload: input.payload,
    createdAt: new Date().toISOString()
  };

  db.prepare(
    `INSERT INTO agent_run_events (id, run_id, sequence, event_type, payload_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    event.id,
    event.runId,
    event.sequence,
    event.type,
    JSON.stringify(event.payload),
    event.createdAt
  );

  return event;
}

export function listAgentRunEvents(db: Db, runId: string): AgentRunEventRecord[] {
  const rows = db
    .prepare(`SELECT * FROM agent_run_events WHERE run_id = ? ORDER BY sequence ASC`)
    .all(runId) as Array<{
    id: string;
    run_id: string;
    sequence: number;
    event_type: AgentRunEventRecord['type'];
    payload_json: string;
    created_at: string;
  }>;

  return rows.map((row) => ({
    id: row.id,
    runId: row.run_id,
    sequence: row.sequence,
    type: row.event_type,
    payload: parseJsonObject<unknown>(row.payload_json, {}),
    createdAt: row.created_at
  }));
}

export function listAgentRuns(db: Db, sessionId?: string, limit = 50): AgentRunRecord[] {
  const rows = db
    .prepare(
      sessionId
        ? `SELECT * FROM agent_runs WHERE session_id = ? ORDER BY started_at DESC LIMIT ?`
        : `SELECT * FROM agent_runs ORDER BY started_at DESC LIMIT ?`
    )
    .all(...(sessionId ? [sessionId, limit] : [limit])) as RunRow[];

  return rows.map(mapRun);
}

export function listRunSummaries(db: Db, sessionId?: string, limit = 50): AgentRunSummary[] {
  return listAgentRuns(db, sessionId, limit).map((run) => {
    const events = listAgentRunEvents(db, run.id);
    const eventText = (type: AgentRunEventRecord['type']) => {
      const event = events.find((entry) => entry.type === type);
      return event ? JSON.stringify(event.payload) : '';
    };

    return {
      run,
      contextSummary: eventText('agent.context.built'),
      providerResponse: eventText('agent.model.completed'),
      policyDecision: eventText('agent.policy.decided'),
      executionResult: eventText('agent.run.completed') || eventText('agent.run.failed'),
      skillsUsed: events
        .filter((entry) => entry.type === 'agent.skill.selected')
        .flatMap((entry) => {
          const payload = entry.payload as { skills?: string[] };
          return payload.skills ?? [];
        }),
      toolsUsed: events
        .filter((entry) => entry.type === 'agent.tool.completed')
        .map((entry) => {
          const payload = entry.payload as { name?: string };
          return payload.name ?? 'unknown';
        }),
      createdAt: run.startedAt
    };
  });
}

export function pruneOldRunEvents(db: Db, cutoffIso: string): number {
  const result = db
    .prepare(`DELETE FROM agent_run_events WHERE created_at < ?`)
    .run(cutoffIso);
  return result.changes;
}
