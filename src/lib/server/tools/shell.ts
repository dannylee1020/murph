import { spawn } from 'node:child_process';
import { getRuntimeEnv } from '#lib/server/util/env';
import { isBlockedPath } from './file-ops.js';
import type { ToolDefinition } from '#lib/types';

interface ShellCommandRule {
  subcommands: string[];
}

type ShellCommandMap = Record<string, ShellCommandRule>;

const DEFAULT_COMMANDS: ShellCommandMap = {
  ls: { subcommands: ['*'] },
  find: { subcommands: ['*'] },
  grep: { subcommands: ['*'] },
  cat: { subcommands: ['*'] },
  head: { subcommands: ['*'] },
  tail: { subcommands: ['*'] },
  pwd: { subcommands: ['*'] },
  date: { subcommands: ['*'] },
  git: { subcommands: ['log', 'status', 'diff', 'show', 'blame', 'rev-parse', 'ls-files', 'remote'] }
};

const HARD_BLOCKED_COMMANDS = new Set(['rm', 'mv', 'cp', 'chmod', 'chown', 'sudo', 'ssh', 'kill', 'dd']);
const SHELL_META_PATTERN = /&&|\|\||;|\||>>?|<|`|\$\(/;

function loadCommandMap(): ShellCommandMap {
  const raw = getRuntimeEnv().shellAllowedCommandsJson.trim();
  if (!raw) {
    return DEFAULT_COMMANDS;
  }

  try {
    const parsed = JSON.parse(raw) as Record<string, { subcommands?: string[] }>;
    const mapped = Object.fromEntries(
      Object.entries(parsed)
        .filter(([, value]) => Array.isArray(value?.subcommands) && value.subcommands.length > 0)
        .map(([name, value]) => [name, { subcommands: value.subcommands! }])
    );
    return Object.keys(mapped).length > 0 ? mapped : DEFAULT_COMMANDS;
  } catch {
    return DEFAULT_COMMANDS;
  }
}

function tokenize(command: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;

  for (let index = 0; index < command.length; index += 1) {
    const char = command[index];

    if (quote) {
      if (char === quote) {
        quote = null;
      } else {
        current += char;
      }
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }

    if (/\s/.test(char)) {
      if (current) {
        tokens.push(current);
        current = '';
      }
      continue;
    }

    current += char;
  }

  if (quote) {
    throw new Error('Unterminated quoted string');
  }

  if (current) {
    tokens.push(current);
  }

  return tokens;
}

function firstNonFlag(tokens: string[]): { value?: string; index: number } {
  for (let index = 0; index < tokens.length; index += 1) {
    if (!tokens[index].startsWith('-')) {
      return { value: tokens[index], index };
    }
  }

  return { index: -1 };
}

function looksLikePath(value: string): boolean {
  return value.startsWith('/') || value.startsWith('./') || value.startsWith('../') || value.startsWith('~/');
}

function validateArgs(command: string, args: string[]): void {
  if (HARD_BLOCKED_COMMANDS.has(command)) {
    throw new Error(`Command is blocked by Murph safety policy: ${command}`);
  }

  if (command === 'curl' && args.some((arg) => /^-X$/i.test(arg) || /^-X(?:POST|PUT|DELETE|PATCH)$/i.test(arg))) {
    throw new Error('Network write forms are blocked');
  }

  if (command === 'wget' && args.some((arg) => arg === '--post-data')) {
    throw new Error('Network write forms are blocked');
  }

  if (command === 'nc' && args.includes('-l')) {
    throw new Error('Listening sockets are blocked');
  }

  for (const value of args) {
    if (looksLikePath(value) && isBlockedPath(value)) {
      throw new Error('Blocked path reference detected');
    }
  }
}

function validateCommand(tokens: string[]): { command: string; args: string[] } {
  if (tokens.length === 0) {
    throw new Error('Command is required');
  }

  const [command, ...args] = tokens;
  const commands = loadCommandMap();
  const rule = commands[command];

  if (!rule) {
    throw new Error(`Command is not allowed: ${command}`);
  }

  const { value: subcommand, index: subcommandIndex } = firstNonFlag(args);
  if (!rule.subcommands.includes('*')) {
    if (!subcommand || !rule.subcommands.includes(subcommand)) {
      throw new Error(`Subcommand is not allowed: ${command} ${subcommand ?? ''}`.trim());
    }

    if (command === 'git' && subcommand === 'remote') {
      const laterNonFlag = args.slice(subcommandIndex + 1).find((value) => !value.startsWith('-'));
      if (laterNonFlag) {
        throw new Error('git remote is only allowed without further subcommands');
      }
    }
  }

  validateArgs(command, args);

  return { command, args };
}

function run(command: string, args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      shell: false,
      cwd: process.cwd(),
      env: process.env
    });
    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.on('error', reject);
    child.on('close', (code) => {
      resolve({
        stdout: stdout.slice(0, 12000),
        stderr: stderr.slice(0, 12000),
        exitCode: code ?? 0
      });
    });
  });
}

export function createShellExecTool(): ToolDefinition<
  { command: string },
  { command: string; stdout: string; stderr: string; exitCode: number }
> {
  return {
    name: 'shell.exec',
    description: 'Run a read-only shell command from an allowlisted command set.',
    sideEffectClass: 'read',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['command'],
      properties: {
        command: { type: 'string' }
      }
    },
    knowledgeDomains: ['code'],
    retrievalEligible: false,
    optional: true,
    requiresWorkspaceEnablement: true,
    supportsDryRun: true,
    async execute(input) {
      if (SHELL_META_PATTERN.test(input.command)) {
        throw new Error('Shell composition tokens are not allowed');
      }

      const tokens = tokenize(input.command);
      const { command, args } = validateCommand(tokens);
      const result = await run(command, args);

      if (result.exitCode !== 0) {
        throw new Error(result.stderr.trim() || `Command failed with exit code ${result.exitCode}`);
      }

      return {
        command: [command, ...args].join(' '),
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode
      };
    }
  };
}
