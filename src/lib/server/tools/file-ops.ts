import { readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, resolve } from 'node:path';
import { getRuntimeEnv } from '#lib/server/util/env';
import type { ToolDefinition } from '#lib/types';

const BLOCKED_PATH_REGEXES = [
  /\/\.ssh(?:\/|$)/i,
  /\/\.aws(?:\/|$)/i,
  /\/library\/keychains(?:\/|$)/i,
  /\/etc\/shadow$/i,
  /credentials/i,
  /token/i,
  /\.pem$/i,
  /\.key$/i
];

function expandHome(value: string): string {
  if (value === '~') {
    return homedir();
  }

  if (value.startsWith('~/')) {
    return resolve(homedir(), value.slice(2));
  }

  return value;
}

function normalizeAbsolutePath(value: string, baseDir = process.cwd()): string {
  const expanded = expandHome(value);
  return isAbsolute(expanded) ? resolve(expanded) : resolve(baseDir, expanded);
}

function isWithinRoot(path: string, root: string): boolean {
  return path === root || path.startsWith(`${root}/`);
}

export function isBlockedPath(value: string): boolean {
  const absolute = normalizeAbsolutePath(value);
  return BLOCKED_PATH_REGEXES.some((pattern) => pattern.test(absolute));
}

export function getAllowedReadRoots(): string[] {
  const configured = getRuntimeEnv().fileReadAllowedRoots;
  const roots = configured.length > 0 ? configured : ['.'];
  return roots.map((root) => normalizeAbsolutePath(root));
}

export function resolveReadablePath(path: string): string {
  const absolute = normalizeAbsolutePath(path);

  if (isBlockedPath(absolute)) {
    throw new Error('Path is blocked by Murph safety policy');
  }

  const allowedRoots = getAllowedReadRoots();
  if (!allowedRoots.some((root) => isWithinRoot(absolute, root))) {
    throw new Error('Path is outside allowed read roots');
  }

  return absolute;
}

export function createFileReadTool(): ToolDefinition<{ path: string; maxBytes?: number }, { path: string; text: string; truncated: boolean }> {
  return {
    name: 'fs.read',
    description: 'Read a text file from an allowlisted local path.',
    sideEffectClass: 'read',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['path'],
      properties: {
        path: { type: 'string' },
        maxBytes: { type: 'number' }
      }
    },
    knowledgeDomains: ['documentation', 'code', 'meeting'],
    retrievalEligible: false,
    optional: true,
    requiresWorkspaceEnablement: true,
    supportsDryRun: true,
    async execute(input) {
      const absolute = resolveReadablePath(input.path);
      const info = await stat(absolute);

      if (!info.isFile()) {
        throw new Error('Path is not a file');
      }

      const maxBytes = Math.max(256, Math.min(input.maxBytes ?? 12000, 100_000));
      const content = await readFile(absolute, 'utf8');
      const truncated = Buffer.byteLength(content, 'utf8') > maxBytes;

      return {
        path: absolute,
        text: truncated ? Buffer.from(content, 'utf8').subarray(0, maxBytes).toString('utf8') : content,
        truncated
      };
    }
  };
}
