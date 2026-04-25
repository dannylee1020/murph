import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

let loaded = false;

function parseValue(raw: string): string {
  const trimmed = raw.trim();

  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }

  const commentIndex = trimmed.indexOf(' #');
  return commentIndex >= 0 ? trimmed.slice(0, commentIndex).trim() : trimmed;
}

export function loadDotEnv(filePath = path.resolve(process.cwd(), '.env')): void {
  if (loaded) {
    return;
  }
  loaded = true;

  if (!existsSync(filePath)) {
    return;
  }

  const content = readFileSync(filePath, 'utf8');

  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(trimmed);

    if (!match) {
      continue;
    }

    const [, key, rawValue] = match;

    if (process.env[key] === undefined) {
      process.env[key] = parseValue(rawValue);
    }
  }
}
