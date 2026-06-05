import { readdir, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { obsidianVaultPath } from '#app/server/context-sources/obsidian';
import {
  SOURCE_INDEX_SCHEMA_VERSION,
  type SourceIndexResource,
  writeSourceIndexResource
} from '../catalog.js';

const SKIP_DIRS = new Set(['.git', '.obsidian', '.trash', 'node_modules']);
const MAX_FILES = 200;

interface ObsidianIndexResult {
  resourceCount: number;
  changedPaths: string[];
}

async function walkMarkdown(root: string, files: string[], depth = 0): Promise<void> {
  if (depth > 12 || files.length >= MAX_FILES) {
    return;
  }
  const entries = await readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    const nextPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name) && !entry.name.startsWith('.')) {
        await walkMarkdown(nextPath, files, depth + 1);
      }
      continue;
    }
    if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
      files.push(nextPath);
    }
  }
}

function noteTitle(filePath: string): string {
  return path.basename(filePath).replace(/\.md$/i, '');
}

export async function indexObsidianSource(workspaceId: string): Promise<ObsidianIndexResult> {
  const configuredVault = obsidianVaultPath();
  if (!configuredVault) {
    return { resourceCount: 0, changedPaths: [] };
  }
  const vault = await realpath(configuredVault);
  const files: string[] = [];
  await walkMarkdown(vault, files);
  const changedPaths: string[] = [];

  for (const file of files.slice(0, MAX_FILES)) {
    const realFile = await realpath(file);
    const relativePath = path.relative(vault, realFile);
    if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
      throw new Error('Obsidian source index path escaped the configured vault');
    }
    const text = await readFile(realFile, 'utf8').catch(() => '');
    if (!text.trim()) {
      continue;
    }
    const resource: SourceIndexResource = {
      metadata: {
        schemaVersion: SOURCE_INDEX_SCHEMA_VERSION,
        provider: 'obsidian',
        workspaceId,
        resourceType: 'note',
        externalId: relativePath,
        title: noteTitle(realFile),
        url: `obsidian://open?path=${encodeURIComponent(realFile)}`,
        indexedAt: new Date().toISOString(),
        scope: vault,
        readTool: 'obsidian.read_note',
        readInput: { path: relativePath },
        status: 'active',
        tags: ['obsidian']
      },
      routingNotes: `Use this note for questions about ${noteTitle(realFile)} or ${relativePath}.`
    };
    const result = await writeSourceIndexResource(resource);
    changedPaths.push(result.relativePath);
  }

  return { resourceCount: changedPaths.length, changedPaths };
}
