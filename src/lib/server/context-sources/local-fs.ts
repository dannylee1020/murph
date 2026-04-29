import { readdir, readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { getAllowedReadRoots, resolveReadablePath } from '#lib/server/tools/file-ops';
import type { ContextArtifact } from '#lib/types';

const TEXT_FILE_EXTENSIONS = new Set([
  '.md',
  '.mdx',
  '.txt',
  '.js',
  '.ts',
  '.tsx',
  '.jsx',
  '.json',
  '.yml',
  '.yaml',
  '.toml',
  '.py',
  '.go',
  '.rs',
  '.java',
  '.sh',
  '.sql'
]);

const SKIP_DIRS = new Set(['.git', 'node_modules', 'dist', 'build', '.next', '.svelte-kit']);

export interface LocalFileMatch {
  path: string;
  title: string;
  text: string;
  score: number;
}

function tokenize(query: string): string[] {
  return [...new Set(
    query
      .toLowerCase()
      .split(/[^a-z0-9]+/i)
      .map((token) => token.trim())
      .filter((token) => token.length >= 3)
  )];
}

function scoreContent(path: string, content: string, tokens: string[]): number {
  const haystack = `${path}\n${content}`.toLowerCase();
  return tokens.reduce((score, token) => score + (haystack.includes(token) ? 1 : 0), 0);
}

async function walk(root: string, paths: string[], depth = 0): Promise<void> {
  if (depth > 4) {
    return;
  }

  const entries = await readdir(root, { withFileTypes: true });

  for (const entry of entries) {
    const nextPath = join(root, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) {
        await walk(nextPath, paths, depth + 1);
      }
      continue;
    }

    if (entry.isFile() && TEXT_FILE_EXTENSIONS.has(extname(entry.name).toLowerCase())) {
      paths.push(nextPath);
    }
  }
}

export async function searchLocalFiles(query: string, limit = 3): Promise<LocalFileMatch[]> {
  const tokens = tokenize(query);
  if (tokens.length === 0) {
    return [];
  }

  const roots = getAllowedReadRoots();
  const candidates: LocalFileMatch[] = [];

  for (const root of roots) {
    const files: string[] = [];
    await walk(root, files);

    for (const file of files) {
      const safePath = resolveReadablePath(file);
      const content = await readFile(safePath, 'utf8').catch(() => '');
      if (!content) {
        continue;
      }

      const score = scoreContent(safePath, content, tokens);
      if (score === 0) {
        continue;
      }

      candidates.push({
        path: safePath,
        title: safePath.split('/').at(-1) ?? safePath,
        text: content.slice(0, 4000),
        score
      });
    }
  }

  return candidates
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(1, Math.min(limit, 5)));
}

export function toArtifact(match: LocalFileMatch): ContextArtifact {
  return {
    id: `localfs:${match.path}`,
    source: 'localfs',
    type: 'file',
    title: match.title,
    text: match.text,
    metadata: {
      path: match.path,
      score: match.score
    }
  };
}
