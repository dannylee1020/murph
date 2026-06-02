import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parse, stringify } from 'yaml';
import { ensureMemoryRoot } from '#shared/server/memory/root';
import type { SourceIndexHint } from '#shared/types';

export const SOURCE_INDEX_SCHEMA_VERSION = 1;
export const SOURCE_INDEX_MAX_HINTS = 6;
export const SOURCE_INDEX_MAX_HINT_CHARS = 1200;

export type SourceIndexProvider = 'obsidian' | 'github' | 'notion' | 'linear' | 'granola' | string;
export type SourceIndexStatus = 'active' | 'stale' | 'deleted' | 'unauthorized' | 'error';

export interface SourceIndexResourceMeta {
  schemaVersion: typeof SOURCE_INDEX_SCHEMA_VERSION;
  provider: SourceIndexProvider;
  workspaceId: string;
  resourceType: string;
  externalId: string;
  title: string;
  url?: string;
  sourceUpdatedAt?: string;
  indexedAt: string;
  scope?: string;
  readTool?: string;
  readInput?: Record<string, unknown>;
  status: SourceIndexStatus;
  tags?: string[];
}

export interface SourceIndexResource {
  metadata: SourceIndexResourceMeta;
  summary?: string;
  routingNotes?: string;
  excerpt?: string;
}

export interface SourceIndexWriteResult {
  path: string;
  relativePath: string;
}

export interface SourceIndexGlobalIndexInput {
  updatedAt: string;
  resources: Array<{
    provider: string;
    workspaceId: string;
    resourceType: string;
    title: string;
    status: SourceIndexStatus;
    relativePath: string;
  }>;
}

interface ParsedMarkdown {
  metadata: SourceIndexResourceMeta;
  body: string;
}

function compactText(value: string, limit: number): string {
  const compacted = value.replace(/\s+/g, ' ').trim();
  return compacted.length > limit ? `${compacted.slice(0, limit - 3)}...` : compacted;
}

export function sourceIndexSafeSegment(value: string): string {
  const normalized = value.trim();
  if (!normalized) {
    return 'unknown';
  }
  const readable = normalized
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  const hash = createHash('sha256').update(normalized).digest('hex').slice(0, 12);
  return readable ? `${readable}-${hash}` : hash;
}

async function sourceIndexRoot(): Promise<string> {
  const root = await ensureMemoryRoot();
  const sourceRoot = path.join(root, 'source-index');
  await mkdir(sourceRoot, { recursive: true, mode: 0o700 });
  return sourceRoot;
}

function assertInside(root: string, candidate: string): string {
  const resolved = path.resolve(candidate);
  const relation = path.relative(root, resolved);
  if (relation === '' || relation.startsWith('..') || path.isAbsolute(relation)) {
    throw new Error('Source index path must stay inside the source index root');
  }
  return resolved;
}

function resourceRelativePath(metadata: Pick<SourceIndexResourceMeta, 'workspaceId' | 'provider' | 'resourceType' | 'externalId'>): string {
  return path.join(
    'workspaces',
    sourceIndexSafeSegment(metadata.workspaceId),
    sourceIndexSafeSegment(metadata.provider),
    sourceIndexSafeSegment(metadata.resourceType),
    `${sourceIndexSafeSegment(metadata.externalId)}.md`
  );
}

function yamlFrontmatter(data: SourceIndexResourceMeta): string {
  return `---\n${stringify(data, { lineWidth: 120 }).trimEnd()}\n---\n`;
}

function section(title: string, value: string | undefined, limit: number): string {
  return [`## ${title}`, '', compactText(value ?? '', limit), ''].join('\n');
}

function renderResource(resource: SourceIndexResource): string {
  return [
    yamlFrontmatter(resource.metadata),
    '',
    section('Routing Notes', resource.routingNotes, 800)
  ].filter(Boolean).join('\n').trimEnd() + '\n';
}

async function writeAtomic(filePath: string, body: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tempPath, body, 'utf8');
  await rename(tempPath, filePath);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function requiredString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`Source index resource is missing required metadata: ${key}`);
  }
  return value.trim();
}

function optionalString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function optionalTags(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const tags = value
    .map((tag) => typeof tag === 'string' ? tag.trim() : '')
    .filter(Boolean)
    .slice(0, 20);
  return tags.length ? tags : undefined;
}

function optionalInput(value: unknown): Record<string, unknown> | undefined {
  const record = asRecord(value);
  return Object.keys(record).length > 0 ? record : undefined;
}

function parseStatus(value: unknown): SourceIndexStatus {
  if (value === 'active' || value === 'stale' || value === 'deleted' || value === 'unauthorized' || value === 'error') {
    return value;
  }
  throw new Error('Source index resource has invalid status');
}

function parseMetadata(value: unknown): SourceIndexResourceMeta {
  const record = asRecord(value);
  if (record.schemaVersion !== SOURCE_INDEX_SCHEMA_VERSION) {
    throw new Error('Source index resource has unsupported schemaVersion');
  }
  return {
    schemaVersion: SOURCE_INDEX_SCHEMA_VERSION,
    provider: requiredString(record, 'provider'),
    workspaceId: requiredString(record, 'workspaceId'),
    resourceType: requiredString(record, 'resourceType'),
    externalId: requiredString(record, 'externalId'),
    title: requiredString(record, 'title'),
    url: optionalString(record, 'url'),
    sourceUpdatedAt: optionalString(record, 'sourceUpdatedAt'),
    indexedAt: requiredString(record, 'indexedAt'),
    scope: optionalString(record, 'scope'),
    readTool: optionalString(record, 'readTool'),
    readInput: optionalInput(record.readInput),
    status: parseStatus(record.status),
    tags: optionalTags(record.tags)
  };
}

function parseMarkdown(text: string): ParsedMarkdown {
  if (!text.startsWith('---\n')) {
    throw new Error('Source index resource is missing required frontmatter');
  }
  const end = text.indexOf('\n---\n', 4);
  if (end === -1) {
    throw new Error('Source index resource has unterminated frontmatter');
  }
  const metadata = parseMetadata(parse(text.slice(4, end)));
  return {
    metadata,
    body: text.slice(end + 5).trim()
  };
}

function sectionText(body: string, title: string): string | undefined {
  const escaped = title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = body.match(new RegExp(`^## ${escaped}\\s*\\n+([\\s\\S]*?)(?=\\n## |$)`, 'm'));
  return match?.[1]?.trim() || undefined;
}

async function walkMarkdown(root: string, files: string[]): Promise<void> {
  const entries = await readdir(root, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') {
      return [];
    }
    throw error;
  });
  for (const entry of entries) {
    const nextPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      await walkMarkdown(nextPath, files);
      continue;
    }
    if (entry.isFile() && entry.name.endsWith('.md') && !entry.name.includes('.tmp')) {
      files.push(nextPath);
    }
  }
}

function scoreResource(resource: SourceIndexResource, terms: string[], order: number): number {
  const haystack = [
    resource.metadata.title,
    resource.metadata.provider,
    resource.metadata.resourceType,
    resource.metadata.tags?.join(' '),
    resource.summary,
    resource.routingNotes,
    resource.excerpt
  ].filter(Boolean).join('\n').toLowerCase();
  let score = 0;
  for (const term of terms) {
    if (haystack.includes(term)) {
      score += resource.metadata.title.toLowerCase().includes(term) ? 8 : 3;
    }
  }
  return score - order / 1000;
}

function tokenize(value: string): string[] {
  return [...new Set(value.toLowerCase().split(/[^a-z0-9._#/-]+/i).map((term) => term.trim()).filter((term) => term.length >= 3))];
}

function toHint(resource: SourceIndexResource): SourceIndexHint {
  const text = [
    resource.routingNotes ? `Routing: ${resource.routingNotes}` : '',
  ].filter(Boolean).join('\n');
  return {
    provider: resource.metadata.provider,
    resourceType: resource.metadata.resourceType,
    title: resource.metadata.title,
    externalId: resource.metadata.externalId,
    url: resource.metadata.url,
    readTool: resource.metadata.readTool,
    readInput: resource.metadata.readInput,
    tags: resource.metadata.tags,
    text: compactText(text, SOURCE_INDEX_MAX_HINT_CHARS)
  };
}

export async function writeSourceIndexResource(resource: SourceIndexResource): Promise<SourceIndexWriteResult> {
  const root = await sourceIndexRoot();
  const relativePath = resourceRelativePath(resource.metadata);
  const filePath = assertInside(root, path.join(root, relativePath));
  await writeAtomic(filePath, renderResource(resource));
  return { path: filePath, relativePath };
}

export async function markSourceIndexProviderResourcesStatus(input: {
  workspaceId: string;
  provider: string;
  status: SourceIndexStatus;
}): Promise<SourceIndexWriteResult[]> {
  const root = await sourceIndexRoot();
  const files: string[] = [];
  await walkMarkdown(path.join(root, 'workspaces'), files);
  const changed: SourceIndexWriteResult[] = [];
  for (const file of files) {
    const safePath = assertInside(root, file);
    const parsed = parseMarkdown(await readFile(safePath, 'utf8'));
    if (parsed.metadata.workspaceId !== input.workspaceId || parsed.metadata.provider !== input.provider) {
      continue;
    }
    const resource: SourceIndexResource = {
      metadata: {
        ...parsed.metadata,
        status: input.status,
        indexedAt: new Date().toISOString()
      },
      routingNotes: sectionText(parsed.body, 'Routing Notes')
    };
    await writeAtomic(safePath, renderResource(resource));
    changed.push({ path: safePath, relativePath: path.relative(root, safePath) });
  }
  return changed;
}

export async function writeSourceIndexGlobalIndex(input: SourceIndexGlobalIndexInput): Promise<SourceIndexWriteResult> {
  const root = await sourceIndexRoot();
  const relativePath = 'index.md';
  const filePath = assertInside(root, path.join(root, relativePath));
  const lines = [
    '# Murph Source Index',
    '',
    `Updated: ${input.updatedAt}`,
    '',
    'This markdown catalog contains source-location routing metadata only. It is not factual grounding evidence.',
    '',
    ...input.resources.map((resource) => [
      `- ${resource.title}`,
      `  - provider: ${resource.provider}`,
      `  - workspaceId: ${resource.workspaceId}`,
      `  - resourceType: ${resource.resourceType}`,
      `  - status: ${resource.status}`,
      `  - path: ${resource.relativePath}`
    ].join('\n'))
  ];
  await writeAtomic(filePath, `${lines.join('\n')}\n`);
  return { path: filePath, relativePath };
}

export class SourceIndexCatalog {
  private resources: SourceIndexResource[] = [];

  async reload(): Promise<void> {
    const root = await sourceIndexRoot();
    const files: string[] = [];
    await walkMarkdown(path.join(root, 'workspaces'), files);
    const resources: SourceIndexResource[] = [];
    for (const file of files) {
      const safePath = assertInside(root, file);
      const parsed = parseMarkdown(await readFile(safePath, 'utf8'));
      resources.push({
        metadata: parsed.metadata,
        summary: sectionText(parsed.body, 'Summary'),
        routingNotes: sectionText(parsed.body, 'Routing Notes'),
        excerpt: sectionText(parsed.body, 'Excerpt')
      });
    }
    this.resources = resources;
  }

  hintsFor(input: { workspaceId: string; query: string; limit?: number; maxChars?: number }): SourceIndexHint[] {
    const terms = tokenize(input.query);
    if (terms.length === 0) {
      return [];
    }
    const maxHints = Math.max(1, Math.min(input.limit ?? SOURCE_INDEX_MAX_HINTS, SOURCE_INDEX_MAX_HINTS));
    const maxChars = Math.max(200, Math.min(input.maxChars ?? SOURCE_INDEX_MAX_HINT_CHARS, SOURCE_INDEX_MAX_HINT_CHARS));
    return this.resources
      .filter((resource) => resource.metadata.workspaceId === input.workspaceId && resource.metadata.status === 'active')
      .map((resource, order) => ({ resource, score: scoreResource(resource, terms, order) }))
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score || a.resource.metadata.title.localeCompare(b.resource.metadata.title))
      .slice(0, maxHints)
      .map(({ resource }) => ({
        ...toHint(resource),
        text: compactText(toHint(resource).text, maxChars)
      }));
  }
}

let catalog: SourceIndexCatalog | null = null;

export function getSourceIndexCatalog(): SourceIndexCatalog {
  if (!catalog) {
    catalog = new SourceIndexCatalog();
  }
  return catalog;
}
