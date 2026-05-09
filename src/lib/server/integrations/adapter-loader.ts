import { access, readdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { registerAdapter, recordAdapterLoadFailure } from './adapter-registry.js';
import type { IntegrationAdapter } from './adapter.js';

let loaded = false;

function murphHome(): string {
  return process.env.MURPH_HOME || path.join(homedir(), '.murph');
}

export function getIntegrationAdapterDirs(): string[] {
  return [
    path.join(murphHome(), 'integrations'),
    path.resolve(process.cwd(), 'integrations')
  ];
}

function isAdapterFile(fileName: string): boolean {
  return fileName.endsWith('.js') || fileName.endsWith('.mjs');
}

function moduleAdapter(module: Record<string, unknown>): IntegrationAdapter | undefined {
  const candidate = module.default ?? module.adapter;
  if (!candidate || typeof candidate !== 'object') {
    return undefined;
  }
  return candidate as IntegrationAdapter;
}

async function loadAdapterFile(filePath: string): Promise<void> {
  try {
    const module = await import(pathToFileURL(filePath).href);
    const adapter = moduleAdapter(module as Record<string, unknown>);
    if (!adapter) {
      recordAdapterLoadFailure({
        id: path.basename(filePath),
        source: 'user',
        filePath,
        status: 'skipped',
        error: 'No default export or named adapter export found'
      });
      return;
    }

    registerAdapter(adapter, { source: 'user', filePath });
  } catch (error) {
    recordAdapterLoadFailure({
      id: path.basename(filePath),
      source: 'user',
      filePath,
      error: error instanceof Error ? error.message : 'failed to load adapter'
    });
  }
}

async function loadAdapterDirectory(dirPath: string): Promise<void> {
  for (const fileName of ['index.js', 'index.mjs']) {
    const filePath = path.join(dirPath, fileName);
    try {
      await access(filePath);
    } catch {
      continue;
    }
    await loadAdapterFile(filePath);
    return;
  }

  recordAdapterLoadFailure({
    id: path.basename(dirPath),
    source: 'user',
    filePath: dirPath,
    status: 'skipped',
    error: 'No index.js or index.mjs found'
  });
}

export async function loadIntegrationAdapters(): Promise<void> {
  if (loaded) {
    return;
  }

  for (const dir of getIntegrationAdapterDirs()) {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT') {
        recordAdapterLoadFailure({
          id: path.basename(dir),
          source: 'user',
          filePath: dir,
          error: error instanceof Error ? error.message : 'failed to read adapter directory'
        });
      }
      continue;
    }

    for (const entry of entries) {
      if (entry.isFile() && isAdapterFile(entry.name)) {
        await loadAdapterFile(path.join(dir, entry.name));
      } else if (entry.isDirectory()) {
        await loadAdapterDirectory(path.join(dir, entry.name));
      }
    }
  }

  loaded = true;
}
