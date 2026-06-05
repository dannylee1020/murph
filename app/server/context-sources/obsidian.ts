import { constants } from 'node:fs';
import { access, readdir, readFile, realpath, stat } from 'node:fs/promises';
import { extname, isAbsolute, join, relative, resolve } from 'node:path';
import { getRuntimeEnv } from '#app/server/util/env';
import { readMurphConfig } from '#app/server/setup/config-file';
import type { ContextArtifact } from '#app/types';

export interface ObsidianNoteResult {
  path: string;
  relativePath: string;
  title: string;
  text: string;
  url: string;
  backlinks: string[];
  wikilinks: string[];
  score?: number;
}

export interface ObsidianConnectionStatus {
  configured: boolean;
  source?: 'env' | 'config';
  vaultPath?: string;
}

const SKIP_DIRS = new Set(['.git', '.obsidian', '.trash', 'node_modules']);

export function obsidianVaultPath(): string | null {
  const value = getRuntimeEnv().obsidianVaultPath?.trim();
  return value ? resolve(value) : null;
}

export function getObsidianConnectionStatus(): ObsidianConnectionStatus {
  const envPath = process.env.OBSIDIAN_VAULT_PATH?.trim();
  if (envPath) {
    return { configured: true, source: 'env', vaultPath: resolve(envPath) };
  }

  const configPath = readMurphConfig().integrations?.obsidian?.vaultPath?.trim();
  if (configPath) {
    return { configured: true, source: 'config', vaultPath: resolve(configPath) };
  }

  return { configured: false };
}

function extractWikilinks(text: string): string[] {
  const matches = [...text.matchAll(/\[\[([^[\]|#]+)(?:[|#][^\]]*)?\]\]/g)];
  return [...new Set(matches.map((match) => match[1].trim()).filter(Boolean))];
}

function extractFrontmatter(text: string): string {
  if (!text.startsWith('---\n')) {
    return text;
  }

  const end = text.indexOf('\n---\n', 4);
  if (end === -1) {
    return text;
  }

  return text.slice(end + 5);
}

function tokenize(query: string): string[] {
  return [...new Set(query
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3))];
}

function scoreNote(path: string, text: string, tokens: string[]): number {
  const haystack = `${path}\n${text}`.toLowerCase();
  return tokens.reduce((score, token) => score + (haystack.includes(token) ? 1 : 0), 0);
}

async function walkMarkdown(root: string, files: string[], depth = 0): Promise<void> {
  if (depth > 12 || files.length > 5000) {
    return;
  }

  const entries = await readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    const nextPath = join(root, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name) && !entry.name.startsWith('.')) {
        await walkMarkdown(nextPath, files, depth + 1);
      }
      continue;
    }

    if (entry.isFile() && extname(entry.name).toLowerCase() === '.md') {
      files.push(nextPath);
    }
  }
}

function assertInsideVault(vaultPath: string, candidate: string): string {
  const fullPath = resolve(candidate);
  const relation = relative(vaultPath, fullPath);
  if (relation === '' || relation.startsWith('..') || isAbsolute(relation)) {
    throw new Error('Obsidian note path must stay inside the configured vault');
  }
  return fullPath;
}

async function assertRealPathInsideVault(vaultPath: string, candidate: string): Promise<void> {
  const [realVaultPath, realCandidatePath] = await Promise.all([
    realpath(vaultPath),
    realpath(candidate)
  ]);
  assertInsideVault(realVaultPath, realCandidatePath);
}

async function readVaultFile(vaultPath: string, candidate: string): Promise<{ fullPath: string; text: string }> {
  const fullPath = assertInsideVault(vaultPath, candidate);
  await assertRealPathInsideVault(vaultPath, fullPath);
  return {
    fullPath,
    text: await readFile(fullPath, 'utf8')
  };
}

function noteTitle(path: string): string {
  return path.split('/').at(-1)?.replace(/\.md$/i, '') ?? path;
}

function obsidianUri(path: string): string {
  return `obsidian://open?path=${encodeURIComponent(path)}`;
}

function resultFromText(input: {
  vaultPath: string;
  path: string;
  text: string;
  score?: number;
}): ObsidianNoteResult {
  const visibleText = extractFrontmatter(input.text);
  const relativePath = relative(input.vaultPath, input.path);
  return {
    path: input.path,
    relativePath,
    title: noteTitle(input.path),
    text: visibleText.slice(0, 6000),
    url: obsidianUri(input.path),
    backlinks: [],
    wikilinks: extractWikilinks(input.text),
    score: input.score
  };
}

export async function validateObsidianVaultPath(path: string): Promise<{ vaultPath: string }> {
  const vaultPath = resolve(path.trim());
  const info = await stat(vaultPath).catch(() => {
    throw new Error('Obsidian vault path does not exist');
  });
  if (!info.isDirectory()) {
    throw new Error('Obsidian vault path must be a directory');
  }
  await access(vaultPath, constants.R_OK).catch(() => {
    throw new Error('Obsidian vault path is not readable');
  });
  return { vaultPath: await realpath(vaultPath) };
}

export async function searchObsidianNotes(query: string, limit = 3): Promise<ObsidianNoteResult[]> {
  const vault = obsidianVaultPath();
  if (!vault) {
    throw new Error('OBSIDIAN_VAULT_PATH is not configured');
  }

  const tokens = tokenize(query);
  if (tokens.length === 0) {
    return [];
  }

  const files: string[] = [];
  await walkMarkdown(vault, files);
  const candidates: ObsidianNoteResult[] = [];

  for (const file of files) {
    const safePath = assertInsideVault(vault, file);
    const text = await readFile(safePath, 'utf8').catch(() => '');
    if (!text) {
      continue;
    }
    const score = scoreNote(relative(vault, safePath), text, tokens);
    if (score === 0) {
      continue;
    }
    candidates.push(resultFromText({ vaultPath: vault, path: safePath, text, score }));
  }

  return candidates
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || a.relativePath.localeCompare(b.relativePath))
    .slice(0, Math.max(1, Math.min(limit, 10)));
}

export async function readObsidianNote(path: string): Promise<ObsidianNoteResult> {
  const vault = obsidianVaultPath();
  if (!vault) {
    throw new Error('OBSIDIAN_VAULT_PATH is not configured');
  }

  const candidate = isAbsolute(path) ? path : join(vault, path);
  const note = await readVaultFile(vault, candidate).catch(async (error) => {
    if (extname(candidate)) {
      throw error;
    }
    return await readVaultFile(vault, `${candidate}.md`);
  });

  return resultFromText({ vaultPath: vault, path: note.fullPath, text: note.text });
}

export function isObsidianConfigured(): boolean {
  return Boolean(obsidianVaultPath());
}

export function toArtifact(note: ObsidianNoteResult): ContextArtifact {
  return {
    id: `obsidian:${note.path}`,
    source: 'obsidian',
    type: 'document',
    title: note.title,
    text: note.text,
    url: note.url,
    metadata: {
      path: note.path,
      relativePath: note.relativePath,
      wikilinks: note.wikilinks,
      score: note.score
    }
  };
}
