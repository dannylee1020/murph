import { readFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { getRuntimeEnv } from '#lib/server/util/env';
import { searchLocalFiles } from './local-fs.js';
import type { ContextArtifact } from '#lib/types';

export interface ObsidianNoteResult {
  path: string;
  title: string;
  text: string;
  backlinks: string[];
  wikilinks: string[];
}

function obsidianVaultPath(): string | null {
  const path = getRuntimeEnv().obsidianVaultPath?.trim();
  return path ? path : null;
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

export async function searchObsidianNotes(query: string, limit = 3): Promise<ObsidianNoteResult[]> {
  const vault = obsidianVaultPath();
  if (!vault) {
    throw new Error('OBSIDIAN_VAULT_PATH is not configured');
  }

  const results = await searchLocalFiles(query, limit * 2);

  return results
    .filter((result) => result.path.startsWith(vault))
    .slice(0, limit)
    .map((result) => ({
      path: result.path,
      title: result.title.replace(/\.md$/i, ''),
      text: extractFrontmatter(result.text),
      backlinks: [],
      wikilinks: extractWikilinks(result.text)
    }));
}

export async function readObsidianNote(path: string): Promise<ObsidianNoteResult> {
  const vault = obsidianVaultPath();
  if (!vault) {
    throw new Error('OBSIDIAN_VAULT_PATH is not configured');
  }

  const fullPath = isAbsolute(path) ? path : join(vault, path);
  const text = await readFile(fullPath, 'utf8');

  return {
    path: fullPath,
    title: fullPath.split('/').at(-1)?.replace(/\.md$/i, '') ?? fullPath,
    text: extractFrontmatter(text).slice(0, 6000),
    backlinks: [],
    wikilinks: extractWikilinks(text)
  };
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
    metadata: {
      path: note.path,
      wikilinks: note.wikilinks
    }
  };
}
