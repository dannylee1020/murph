import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { access, mkdir, readdir, readFile, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parse, stringify } from 'yaml';
import { ensureMemoryRoot } from '#app/server/memory/root';
import { getStore } from '#app/server/persistence/store';
import type { AgentRunEventRecord, AgentRunRecord, AutopilotSession, ThreadMemory } from '#app/types';

const MAX_PAGE_TEXT_CHARS = 18000;
const MAX_INDEX_CHARS = 12000;
const INDEX_HEADER = [
  '# Murph Memory Index',
  '',
  'Generated from SQLite run history. Use this index only for stable or follow-up questions. If the request asks for latest, current, today, now, status, or source-of-truth evidence, use live retrieval.',
  ''
].join('\n');
const REFRESH_WHEN = [
  'asked for latest status',
  'asked for current source-of-truth',
  'new blocker or timeline change mentioned'
];

export interface MemoryPageMeta {
  title: string;
  path: string;
  page_type: 'session' | 'thread';
  workspace_id: string;
  session_id?: string;
  channel_id?: string;
  thread_ts?: string;
  summary: string;
  keywords: string[];
  sources: string[];
  freshness: 'snapshot';
  last_updated_at: string;
  refresh_when: string[];
  run_ids: string[];
  event_ids: string[];
}

export interface MemoryPageRead {
  path: string;
  metadata: MemoryPageMeta;
  text: string;
}

interface SourceSummary {
  source: string;
  title: string;
  url?: string;
}

interface ToolSummary {
  name: string;
  ok: boolean;
  summary?: string;
  error?: string;
}

interface RunSummary {
  run: AgentRunRecord;
  request: string;
  contextSummary?: string;
  skills: string[];
  model?: string;
  modelAction?: string;
  modelReason?: string;
  policyReasons: string[];
  tools: ToolSummary[];
  sources: SourceSummary[];
  memoryNotes: string[];
  actions: string[];
  result?: string;
  eventIds: string[];
}

function hashText(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

function compactText(text: string, limit: number): string {
  const compacted = text.replace(/\s+/g, ' ').trim();
  return compacted.length > limit ? `${compacted.slice(0, limit - 3)}...` : compacted;
}

function truncateText(text: string, limit: number): string {
  return text.length > limit ? `${text.slice(0, limit - 3)}...` : text;
}

function segment(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 96) || 'unknown';
}

function yamlFrontmatter(data: unknown): string {
  return `---\n${stringify(data, { lineWidth: 120 }).trimEnd()}\n---\n`;
}

async function writeAtomic(filePath: string, body: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tempPath, body, 'utf8');
  await rename(tempPath, filePath);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function summarizeValue(value: unknown, limit = 220): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value === 'string') {
    return compactText(value, limit);
  }
  try {
    return compactText(JSON.stringify(value), limit);
  } catch {
    return undefined;
  }
}

function extractTerms(values: string[]): string[] {
  const terms = new Set<string>();
  for (const value of values) {
    const words = value
      .split(/[^a-z0-9#._/-]+/i)
      .map((word) => word.trim())
      .filter((word) => word.length >= 3 && !/^\d+$/.test(word));
    for (const word of words.slice(0, 20)) {
      terms.add(word);
    }
  }
  return [...terms].slice(0, 32);
}

function eventPayload(events: AgentRunEventRecord[], type: AgentRunEventRecord['type']): Record<string, unknown> | undefined {
  const event = events.find((entry) => entry.type === type);
  return event ? asRecord(event.payload) : undefined;
}

function eventPayloads(events: AgentRunEventRecord[], type: AgentRunEventRecord['type']): Record<string, unknown>[] {
  return events.filter((entry) => entry.type === type).map((entry) => asRecord(entry.payload));
}

function requestFromRun(run: AgentRunRecord, events: AgentRunEventRecord[]): string {
  const started = eventPayload(events, 'agent.run.started');
  const task = asRecord(started?.task);
  const trigger = asRecord(task.triggerMessage);
  return stringValue(trigger.text) ?? `Task ${run.taskId}`;
}

function sourceSummariesFromIndex(events: AgentRunEventRecord[]): SourceSummary[] {
  const indexSource = [...events].reverse().find((event) => event.type === 'agent.memory.index_source');
  const payload = asRecord(indexSource?.payload);
  const sources: SourceSummary[] = [];
  const artifacts = Array.isArray(payload.artifacts) ? payload.artifacts : [];
  for (const artifact of artifacts) {
    const record = asRecord(artifact);
    const source = stringValue(record.source);
    const title = stringValue(record.title);
    if (source && title && !source.startsWith('memory.')) {
      sources.push({ source, title, url: stringValue(record.url) });
    }
  }

  const toolResults = Array.isArray(payload.toolResults) ? payload.toolResults : [];
  for (const result of toolResults) {
    const record = asRecord(result);
    if (record.ok !== true) {
      continue;
    }
    const name = stringValue(record.name);
    if (!name || name.startsWith('memory.')) {
      continue;
    }
    sources.push({
      source: name,
      title: `${name} result`
    });
  }

  const seen = new Set<string>();
  return sources.filter((source) => {
    const key = `${source.source}\n${source.title}\n${source.url ?? ''}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  }).slice(0, 16);
}

function toolSummaries(events: AgentRunEventRecord[]): ToolSummary[] {
  const tools = eventPayloads(events, 'agent.tool.completed').map((payload) => ({
    name: stringValue(payload.name) ?? 'unknown',
    ok: payload.ok === true,
    summary: summarizeValue(payload.outputSummary),
    error: stringValue(payload.error)
  }));

  const indexSource = [...events].reverse().find((event) => event.type === 'agent.memory.index_source');
  const toolResults = Array.isArray(asRecord(indexSource?.payload).toolResults)
    ? asRecord(indexSource?.payload).toolResults as unknown[]
    : [];
  for (const result of toolResults) {
    const record = asRecord(result);
    const name = stringValue(record.name);
    if (!name || tools.some((tool) => tool.name === name)) {
      continue;
    }
    tools.push({
      name,
      ok: record.ok === true,
      summary: summarizeValue(record.output),
      error: stringValue(record.error)
    });
  }

  return tools.slice(0, 24);
}

function summarizeRun(run: AgentRunRecord, events: AgentRunEventRecord[]): RunSummary {
  const context = eventPayload(events, 'agent.context.built');
  const skillPayloads = eventPayloads(events, 'agent.skill.selected');
  const model = [...eventPayloads(events, 'agent.model.completed')].pop();
  const policyReasons = eventPayloads(events, 'agent.policy.decided')
    .map((payload) => stringValue(payload.reason) ?? stringValue(payload.policyReason))
    .filter((reason): reason is string => Boolean(reason));
  const memoryNotes = [
    ...eventPayloads(events, 'agent.memory.written').map((payload) => `Written: ${summarizeValue(payload.tools) ?? 'thread memory'}`),
    ...eventPayloads(events, 'agent.memory.skipped').map((payload) => `Skipped: ${stringValue(payload.reason) ?? 'memory write skipped'}`),
    ...eventPayloads(events, 'agent.memory.indexed').map((payload) => `Indexed: ${stringValue(payload.status) ?? 'indexed'}`),
    ...eventPayloads(events, 'agent.memory.index_failed').map((payload) => `Index failed: ${stringValue(payload.error) ?? 'unknown error'}`)
  ];
  const actions = [
    ...eventPayloads(events, 'agent.action.sent').map((payload) => `Sent ${stringValue(payload.action) ?? 'action'}`),
    ...eventPayloads(events, 'agent.action.queued').map((payload) => `Queued ${stringValue(payload.action) ?? 'action'}${stringValue(payload.itemId) ? ` (${stringValue(payload.itemId)})` : ''}`)
  ];
  const completed = eventPayload(events, 'agent.run.completed');
  const failed = eventPayload(events, 'agent.run.failed');

  return {
    run,
    request: requestFromRun(run, events),
    contextSummary: stringValue(context?.summary),
    skills: [...new Set(skillPayloads.flatMap((payload) => (
      Array.isArray(payload.skills) ? payload.skills.filter((skill): skill is string => typeof skill === 'string') : []
    )))],
    model: stringValue(model?.provider),
    modelAction: stringValue(model?.action),
    modelReason: stringValue(model?.reason),
    policyReasons,
    tools: toolSummaries(events),
    sources: sourceSummariesFromIndex(events),
    memoryNotes,
    actions,
    result: stringValue(completed?.executionResult) ?? stringValue(failed?.error),
    eventIds: events.map((event) => event.id)
  };
}

function runBlock(summary: RunSummary): string[] {
  const lines = [
    `### ${summary.run.startedAt} - ${summary.run.id}`,
    '',
    `- Request: ${summary.request}`,
    `- Status: ${summary.run.status}`,
    summary.contextSummary ? `- Context: ${summary.contextSummary}` : undefined,
    summary.modelAction ? `- Model action: ${summary.modelAction}${summary.modelReason ? ` (${summary.modelReason})` : ''}` : undefined,
    summary.result ? `- Result: ${summary.result}` : undefined
  ].filter((line): line is string => Boolean(line));

  if (summary.skills.length > 0) {
    lines.push(`- Skills: ${summary.skills.join(', ')}`);
  }
  if (summary.policyReasons.length > 0) {
    lines.push(`- Policy: ${summary.policyReasons.join(' | ')}`);
  }
  if (summary.actions.length > 0) {
    lines.push(`- Actions: ${summary.actions.join(' | ')}`);
  }
  if (summary.tools.length > 0) {
    const succeeded = summary.tools.filter((tool) => tool.ok).map((tool) => tool.name);
    const failed = summary.tools.filter((tool) => !tool.ok).map((tool) => `${tool.name}${tool.error ? ` (${tool.error})` : ''}`);
    lines.push(`- Tools succeeded: ${succeeded.join(', ') || 'none'}`);
    lines.push(`- Tools failed: ${failed.join(', ') || 'none'}`);
  }
  if (summary.sources.length > 0) {
    lines.push('- Sources:');
    for (const source of summary.sources.slice(0, 8)) {
      lines.push(`  - ${source.source}: ${source.title}${source.url ? ` (${source.url})` : ''}`);
    }
  }
  if (summary.memoryNotes.length > 0) {
    lines.push(`- Memory: ${summary.memoryNotes.join(' | ')}`);
  }
  lines.push(`- Provenance: run ${summary.run.id}; events ${summary.eventIds.join(', ') || 'none'}`);
  lines.push('');
  return lines;
}

function pageCard(meta: MemoryPageMeta): string {
  const scope = meta.page_type === 'session'
    ? `workspace ${meta.workspace_id}, session ${meta.session_id}`
    : `workspace ${meta.workspace_id}, thread ${meta.channel_id}/${meta.thread_ts}`;
  return [
    `### ${meta.title}`,
    `path: ${meta.path}`,
    `type: ${meta.page_type}`,
    `scope: ${scope}`,
    `summary: ${meta.summary}`,
    `keywords: ${meta.keywords.join(', ') || 'none'}`,
    `sources: ${meta.sources.join(', ') || 'none'}`,
    `freshness: ${meta.freshness}`,
    `last_updated_at: ${meta.last_updated_at}`,
    `refresh_when: ${meta.refresh_when.join('; ')}`,
    ''
  ].join('\n');
}

function parseFrontmatter(text: string): MemoryPageMeta | null {
  if (!text.startsWith('---\n')) {
    return null;
  }
  const end = text.indexOf('\n---\n', 4);
  if (end === -1) {
    return null;
  }
  const parsed = parse(text.slice(4, end));
  if (!parsed || typeof parsed !== 'object' || !('path' in parsed) || typeof parsed.path !== 'string') {
    return null;
  }
  const meta = parsed as Partial<MemoryPageMeta>;
  if (meta.page_type !== 'session' && meta.page_type !== 'thread') {
    return null;
  }
  return meta as MemoryPageMeta;
}

async function walkMarkdown(root: string, files: string[]): Promise<void> {
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const next = path.join(root, entry.name);
    if (entry.isDirectory()) {
      await walkMarkdown(next, files);
      continue;
    }
    if (entry.isFile() && entry.name.endsWith('.md')) {
      files.push(next);
    }
  }
}

async function indexedMarkdownFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  await walkMarkdown(path.join(root, 'sessions'), files);
  await walkMarkdown(path.join(root, 'threads'), files);
  return files.sort();
}

export async function regenerateMemoryIndex(): Promise<string> {
  const root = await ensureMemoryRoot();
  const cards: string[] = [];

  for (const file of await indexedMarkdownFiles(root)) {
    const text = await readFile(file, 'utf8').catch(() => '');
    const meta = parseFrontmatter(text);
    if (meta) {
      cards.push(pageCard(meta));
    }
  }

  const body = `${INDEX_HEADER}${cards.join('\n')}`;
  await writeAtomic(path.join(root, 'index.md'), body);
  return path.join(root, 'index.md');
}

function pageContent(meta: MemoryPageMeta, sections: string[]): string {
  return truncateText([
    yamlFrontmatter(meta),
    `# ${meta.title}`,
    '',
    '## Reliability',
    '',
    `- Freshness: ${meta.freshness}`,
    `- Refresh when: ${meta.refresh_when.join('; ')}`,
    `- SQLite is the source of truth. This page is a generated recall view.`,
    '',
    ...sections
  ].join('\n'), MAX_PAGE_TEXT_CHARS);
}

function allRunSummaries(store: ReturnType<typeof getStore>, runs: AgentRunRecord[]): RunSummary[] {
  return [...runs]
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt))
    .map((run) => summarizeRun(run, store.listAgentRunEvents(run.id)));
}

async function writeThreadPage(input: {
  root: string;
  run: AgentRunRecord;
  threadMemory?: ThreadMemory;
  summaries: RunSummary[];
}): Promise<string> {
  const relativePath = path.join(
    'threads',
    segment(input.run.workspaceId),
    `${segment(input.run.channelId)}-${segment(input.run.threadTs)}.md`
  );
  const latest = input.summaries.at(-1);
  const summary = input.threadMemory?.summary ?? latest?.contextSummary ?? latest?.request ?? 'No durable summary captured yet.';
  const sourceNames = [...new Set(input.summaries.flatMap((run) => run.sources.map((source) => source.source)))].slice(0, 16);
  const meta: MemoryPageMeta = {
    title: `Thread ${input.run.channelId} ${input.run.threadTs}`,
    path: relativePath,
    page_type: 'thread',
    workspace_id: input.run.workspaceId,
    channel_id: input.run.channelId,
    thread_ts: input.run.threadTs,
    summary: compactText(summary, 320),
    keywords: extractTerms([
      input.run.channelId,
      input.run.threadTs,
      ...input.summaries.flatMap((run) => [
        run.request,
        run.contextSummary ?? '',
        run.modelReason ?? '',
        ...run.tools.map((tool) => tool.name),
        ...run.sources.flatMap((source) => [source.title, source.url ?? ''])
      ])
    ]),
    sources: sourceNames,
    freshness: 'snapshot',
    last_updated_at: latest?.run.completedAt ?? latest?.run.startedAt ?? input.run.completedAt ?? input.run.startedAt,
    refresh_when: REFRESH_WHEN,
    run_ids: input.summaries.map((summaryRun) => summaryRun.run.id),
    event_ids: input.summaries.flatMap((summaryRun) => summaryRun.eventIds)
  };
  const sections = [
    '## Thread Summary',
    '',
    summary,
    '',
    '## Open Questions',
    '',
    ...(input.threadMemory?.openQuestions.length ? input.threadMemory.openQuestions.map((question) => `- ${question}`) : ['- none']),
    '',
    '## Timeline',
    '',
    ...input.summaries.flatMap(runBlock)
  ];
  await writeAtomic(path.join(input.root, relativePath), pageContent(meta, sections));
  return relativePath;
}

async function writeSessionPage(input: {
  root: string;
  session: AutopilotSession;
  summaries: RunSummary[];
}): Promise<string> {
  const relativePath = path.join('sessions', `${segment(input.session.id)}.md`);
  const latest = input.summaries.at(-1);
  const summary = `${input.summaries.length} run${input.summaries.length === 1 ? '' : 's'} handled for ${input.session.title}.`;
  const sourceNames = [...new Set(input.summaries.flatMap((run) => run.sources.map((source) => source.source)))].slice(0, 16);
  const meta: MemoryPageMeta = {
    title: `Session ${input.session.title}`,
    path: relativePath,
    page_type: 'session',
    workspace_id: input.session.workspaceId,
    session_id: input.session.id,
    summary,
    keywords: extractTerms([
      input.session.title,
      input.session.ownerUserId ?? '',
      ...input.session.channelScope,
      ...input.summaries.flatMap((run) => [
        run.request,
        run.contextSummary ?? '',
        run.modelReason ?? '',
        ...run.tools.map((tool) => tool.name),
        ...run.sources.flatMap((source) => [source.title, source.url ?? ''])
      ])
    ]),
    sources: sourceNames,
    freshness: 'snapshot',
    last_updated_at: latest?.run.completedAt ?? latest?.run.startedAt ?? input.session.stoppedAt ?? input.session.startedAt,
    refresh_when: REFRESH_WHEN,
    run_ids: input.summaries.map((summaryRun) => summaryRun.run.id),
    event_ids: input.summaries.flatMap((summaryRun) => summaryRun.eventIds)
  };
  const sections = [
    '## Session Summary',
    '',
    summary,
    '',
    '## Scope',
    '',
    `- Workspace: ${input.session.workspaceId}`,
    `- Owner: ${input.session.ownerUserId}`,
    `- Mode: ${input.session.mode}`,
    `- Status: ${input.session.status}`,
    `- Channels: ${input.session.channelScope.join(', ') || 'none'}`,
    '',
    '## Timeline',
    '',
    ...input.summaries.flatMap(runBlock)
  ];
  await writeAtomic(path.join(input.root, relativePath), pageContent(meta, sections));
  return relativePath;
}

async function cleanupDeprecatedMemoryPaths(root: string): Promise<void> {
  await Promise.all([
    rm(path.join(root, 'raw'), { recursive: true, force: true }),
    rm(path.join(root, 'workspaces'), { recursive: true, force: true }),
    rm(path.join(root, 'wiki'), { recursive: true, force: true }),
    rm(path.join(root, 'log.md'), { force: true })
  ]);
}

export async function rebuildMemoryPagesForRun(run: AgentRunRecord): Promise<{
  contentHash: string;
  pagePaths: string[];
  pageCount: number;
}> {
  const root = await ensureMemoryRoot();
  const store = getStore();
  const pagePaths: string[] = [];
  const threadRuns = store.listAgentRunsForThread(run.workspaceId, run.channelId, run.threadTs, 100);
  const threadSummaries = allRunSummaries(store, threadRuns);
  pagePaths.push(await writeThreadPage({
    root,
    run,
    threadMemory: store.getThreadMemory(run.workspaceId, run.channelId, run.threadTs, run.targetUserId),
    summaries: threadSummaries
  }));

  if (run.sessionId) {
    const session = store.getSessionById(run.sessionId);
    if (session) {
      pagePaths.push(await writeSessionPage({
        root,
        session,
        summaries: allRunSummaries(store, store.listAgentRuns(run.sessionId, 100))
      }));
    }
  }

  await regenerateMemoryIndex();
  await cleanupDeprecatedMemoryPaths(root);

  return {
    contentHash: hashText(JSON.stringify({ runId: run.id, pagePaths })),
    pagePaths,
    pageCount: pagePaths.length
  };
}

export async function readMemoryIndex(maxChars = 8000): Promise<string | null> {
  const root = await ensureMemoryRoot();
  const indexPath = path.join(root, 'index.md');
  const text = await readFile(indexPath, 'utf8').catch(() => '');
  return text ? truncateText(text, Math.min(maxChars, MAX_INDEX_CHARS)) : null;
}

async function indexedPaths(root: string): Promise<Set<string>> {
  const index = await readFile(path.join(root, 'index.md'), 'utf8').catch(() => '');
  const paths = new Set<string>();
  for (const match of index.matchAll(/^path:\s*(.+)$/gm)) {
    paths.add(match[1].trim());
  }
  return paths;
}

export async function readMemoryPage(relativePath: string, maxChars = 12000): Promise<MemoryPageRead> {
  const root = await ensureMemoryRoot();
  const paths = await indexedPaths(root);
  if (!paths.has(relativePath)) {
    throw new Error('Memory page is not listed in the generated index');
  }

  const fullPath = path.resolve(root, relativePath);
  const realRoot = await realpath(root);
  await access(fullPath, constants.R_OK);
  const realPath = await realpath(fullPath);
  if (realPath !== realRoot && !realPath.startsWith(`${realRoot}${path.sep}`)) {
    throw new Error('Memory page path must stay inside the memory root');
  }

  const info = await stat(realPath);
  if (!info.isFile()) {
    throw new Error('Memory page path is not a file');
  }

  const text = await readFile(realPath, 'utf8');
  const metadata = parseFrontmatter(text);
  if (!metadata) {
    throw new Error('Memory page is missing required frontmatter');
  }
  return {
    path: relativePath,
    metadata,
    text: truncateText(text, Math.max(1000, Math.min(maxChars, 30000)))
  };
}
