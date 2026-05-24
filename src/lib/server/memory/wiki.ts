import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { access, appendFile, mkdir, readdir, readFile, realpath, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parse, stringify } from 'yaml';
import { ensureMemoryRoot } from '#lib/server/memory/root';
import type { AgentRunRecord, AgentToolResult, ContextArtifact } from '#lib/types';

const MAX_RAW_TEXT_CHARS = 12000;
const MAX_PAGE_TEXT_CHARS = 16000;
const INDEX_HEADER = [
  '# Murph Memory Index',
  '',
  'Use this index only for stable or follow-up questions. If the request asks for latest, current, today, now, status, or source-of-truth evidence, use live retrieval.',
  ''
].join('\n');

export interface MemoryIndexSourcePayload {
  artifacts?: ContextArtifact[];
  toolResults?: AgentToolResult[];
}

export interface MemoryEvidenceItem {
  id: string;
  title: string;
  source: string;
  type: string;
  text: string;
  url?: string;
}

interface MemoryPageMeta {
  title: string;
  path: string;
  workspace_id: string;
  scope: 'thread';
  answers: string[];
  entities: string[];
  sources: string[];
  freshness: 'stable' | 'snapshot' | 'volatile';
  last_evidence_at: string;
  refresh_when: string[];
  raw_refs: string[];
}

export interface MemoryPageRead {
  path: string;
  metadata: MemoryPageMeta;
  text: string;
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
    .slice(0, 80) || 'unknown';
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

function artifactEvidence(artifact: ContextArtifact): MemoryEvidenceItem | null {
  if (artifact.source.startsWith('memory.')) {
    return null;
  }
  if (!artifact.text.trim()) {
    return null;
  }
  return {
    id: artifact.id,
    title: artifact.title,
    source: artifact.source,
    type: artifact.type,
    text: artifact.text,
    url: artifact.url
  };
}

function toolEvidence(result: AgentToolResult): MemoryEvidenceItem | null {
  if (!result.ok || result.output === undefined || result.name.startsWith('memory.')) {
    return null;
  }
  const text = JSON.stringify(result.output);
  if (!text || text === '{}') {
    return null;
  }
  return {
    id: result.id,
    title: `${result.name} result`,
    source: result.name,
    type: 'tool_result',
    text
  };
}

export function evidenceFromIndexSource(payload: MemoryIndexSourcePayload): MemoryEvidenceItem[] {
  const evidence = [
    ...(payload.artifacts ?? []).map(artifactEvidence),
    ...(payload.toolResults ?? []).map(toolEvidence)
  ].filter((entry): entry is MemoryEvidenceItem => Boolean(entry));

  const byHash = new Map<string, MemoryEvidenceItem>();
  for (const item of evidence) {
    const hash = hashText(`${item.source}\n${item.title}\n${item.text}`);
    if (!byHash.has(hash)) {
      byHash.set(hash, item);
    }
  }
  return [...byHash.values()];
}

function extractTerms(values: string[]): string[] {
  const terms = new Set<string>();
  for (const value of values) {
    const words = value
      .split(/[^a-z0-9#._-]+/i)
      .map((word) => word.trim())
      .filter((word) => word.length >= 3 && !/^\d+$/.test(word));
    for (const word of words.slice(0, 12)) {
      terms.add(word);
    }
  }
  return [...terms].slice(0, 16);
}

async function rawSnapshotPath(input: {
  root: string;
  run: AgentRunRecord;
  evidence: MemoryEvidenceItem;
  index: number;
}): Promise<string> {
  const month = (input.run.completedAt ?? input.run.startedAt).slice(0, 7);
  const fileName = `${String(input.index + 1).padStart(2, '0')}-${segment(input.evidence.source)}-${hashText(input.evidence.text).slice(0, 10)}.md`;
  const relativePath = path.join('raw', month, input.run.id, fileName);
  const fullPath = path.join(input.root, relativePath);
  const body = [
    yamlFrontmatter({
      run_id: input.run.id,
      workspace_id: input.run.workspaceId,
      source: input.evidence.source,
      title: input.evidence.title,
      captured_at: input.run.completedAt ?? new Date().toISOString(),
      content_hash: hashText(input.evidence.text)
    }),
    `# ${input.evidence.title}`,
    '',
    `Source: ${input.evidence.source}`,
    input.evidence.url ? `URL: ${input.evidence.url}` : undefined,
    '',
    '```json',
    compactText(input.evidence.text, MAX_RAW_TEXT_CHARS),
    '```',
    ''
  ].filter((line): line is string => line !== undefined).join('\n');
  await writeAtomic(fullPath, body);
  return relativePath;
}

function pageBody(input: {
  meta: MemoryPageMeta;
  run: AgentRunRecord;
  evidence: MemoryEvidenceItem[];
}): string {
  const lines = [
    yamlFrontmatter(input.meta),
    `# ${input.meta.title}`,
    '',
    '## Scope',
    '',
    `- Workspace: ${input.run.workspaceId}`,
    `- Channel: ${input.run.channelId}`,
    `- Thread: ${input.run.threadTs}`,
    `- Last evidence: ${input.meta.last_evidence_at}`,
    '',
    '## Reliability',
    '',
    `- Freshness: ${input.meta.freshness}`,
    `- Refresh when: ${input.meta.refresh_when.join('; ')}`,
    `- Sources: ${input.meta.sources.join(', ')}`,
    '',
    '## Evidence Summary',
    ''
  ];

  for (const item of input.evidence) {
    lines.push(`### ${item.title}`);
    lines.push('');
    lines.push(`- Source: ${item.source}`);
    if (item.url) {
      lines.push(`- URL: ${item.url}`);
    }
    lines.push('');
    lines.push(compactText(item.text, 1800));
    lines.push('');
  }

  lines.push('## Raw References');
  lines.push('');
  for (const rawRef of input.meta.raw_refs) {
    lines.push(`- ${rawRef}`);
  }
  lines.push('');
  return truncateText(lines.join('\n'), MAX_PAGE_TEXT_CHARS);
}

function pageCard(meta: MemoryPageMeta): string {
  return [
    `### ${meta.title}`,
    `path: ${meta.path}`,
    `scope: workspace ${meta.workspace_id}, thread`,
    `answers: ${meta.answers.join(', ') || 'none'}`,
    `entities: ${meta.entities.join(', ') || 'none'}`,
    `sources: ${meta.sources.join(', ') || 'none'}`,
    `freshness: ${meta.freshness}`,
    `last_evidence_at: ${meta.last_evidence_at}`,
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
  return parsed as MemoryPageMeta;
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

export async function regenerateMemoryIndex(): Promise<string> {
  const root = await ensureMemoryRoot();
  const wikiRoot = path.join(root, 'wiki');
  const files: string[] = [];
  await walkMarkdown(wikiRoot, files);
  const cards: string[] = [];

  for (const file of files.sort()) {
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

export async function writeRunMemoryPage(run: AgentRunRecord, payload: MemoryIndexSourcePayload): Promise<{
  contentHash: string;
  evidenceCount: number;
  pagePath?: string;
}> {
  const root = await ensureMemoryRoot();
  const evidence = evidenceFromIndexSource(payload);
  if (evidence.length === 0) {
    return { contentHash: hashText(`${run.id}:empty`), evidenceCount: 0 };
  }

  const rawRefs: string[] = [];
  for (const [index, item] of evidence.entries()) {
    rawRefs.push(await rawSnapshotPath({ root, run, evidence: item, index }));
  }

  const relativePagePath = path.join(
    'wiki',
    'threads',
    `workspace-${segment(run.workspaceId)}`,
    `${segment(run.channelId)}-${segment(run.threadTs)}.md`
  );
  const sources = [...new Set(evidence.map((item) => item.source))].slice(0, 12);
  const titles = evidence.map((item) => item.title);
  const meta: MemoryPageMeta = {
    title: evidence.length === 1 ? evidence[0].title : `Thread ${run.channelId} ${run.threadTs}`,
    path: relativePagePath,
    workspace_id: run.workspaceId,
    scope: 'thread',
    answers: extractTerms(titles),
    entities: extractTerms([
      run.channelId,
      run.threadTs,
      ...titles,
      ...evidence.flatMap((item) => item.url ? [item.url] : [])
    ]),
    sources,
    freshness: 'snapshot',
    last_evidence_at: run.completedAt ?? new Date().toISOString(),
    refresh_when: [
      'asked for latest status',
      'asked for current source-of-truth',
      'new blocker or timeline change mentioned'
    ],
    raw_refs: rawRefs
  };
  const fullPagePath = path.join(root, relativePagePath);
  await writeAtomic(fullPagePath, pageBody({ meta, run, evidence }));
  await regenerateMemoryIndex();
  await appendFile(path.join(root, 'log.md'), `${new Date().toISOString()} indexed run ${run.id} -> ${relativePagePath}\n`, 'utf8');

  return {
    contentHash: hashText(JSON.stringify({ run, evidence })),
    evidenceCount: evidence.length,
    pagePath: relativePagePath
  };
}

export async function readMemoryIndex(maxChars = 8000): Promise<string | null> {
  const root = await ensureMemoryRoot();
  const indexPath = path.join(root, 'index.md');
  const text = await readFile(indexPath, 'utf8').catch(() => '');
  return text ? compactText(text, maxChars) : null;
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
