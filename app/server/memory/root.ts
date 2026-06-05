import { mkdir, realpath } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';

function expandHome(value: string): string {
  if (value === '~') {
    return homedir();
  }
  if (value.startsWith('~/')) {
    return path.join(homedir(), value.slice(2));
  }
  return value;
}

export function memoryRootPath(): string {
  return path.resolve(expandHome(process.env.MURPH_MEMORY_PATH ?? path.join(homedir(), '.murph', 'memory')));
}

export async function ensureMemoryRoot(): Promise<string> {
  const root = memoryRootPath();
  await mkdir(root, { recursive: true, mode: 0o700 });
  return await realpath(root);
}
