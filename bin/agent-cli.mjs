#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import {
  AuthStorage,
  DefaultResourceLoader,
  ModelRegistry,
  SessionManager,
  createAgentSession,
  defineTool
} from '@mariozechner/pi-coding-agent';
import { getModel } from '@mariozechner/pi-ai';
import { Type } from 'typebox';

const appDir = path.resolve(process.env.MURPH_APP_DIR || process.cwd());
const murphHome = process.env.MURPH_HOME || path.join(homedir(), '.murph');
const agentDir = process.env.MURPH_AGENT_DIR || path.join(murphHome, 'pi-agent');
const murphUrl = process.env.MURPH_URL || `http://localhost:${process.env.MURPH_PORT || '5173'}`;
const rl = readline.createInterface({ input, output });
const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const color = {
  reset: useColor ? '\x1b[0m' : '',
  bold: useColor ? '\x1b[1m' : '',
  dim: useColor ? '\x1b[2m' : '',
  green: useColor ? '\x1b[32m' : '',
  yellow: useColor ? '\x1b[33m' : '',
  cyan: useColor ? '\x1b[36m' : '',
  blue: useColor ? '\x1b[34m' : '',
  magenta: useColor ? '\x1b[35m' : '',
  red: useColor ? '\x1b[31m' : ''
};

const CUSTOM_TOOL_NAMES = [
  'murph_setup_status',
  'murph_setup_doctor',
  'murph_runtime_health',
  'murph_integration_status',
  'murph_integration_connect',
  'murph_plugin_status',
  'murph_plugin_create_draft',
  'murph_plugin_validate',
  'murph_plugin_install',
  'murph_plugin_reload',
  'murph_policy_profiles',
  'murph_policy_get',
  'murph_policy_preview',
  'murph_policy_set'
];

const MUTATING_TOOLS = new Set([
  'edit',
  'write',
  'murph_integration_connect',
  'murph_plugin_create_draft',
  'murph_plugin_install',
  'murph_plugin_reload',
  'murph_policy_set'
]);

function paint(style, text) {
  return `${color[style] || ''}${text}${color.reset}`;
}

function stripAnsi(text) {
  return String(text).replace(/\x1b\[[0-9;]*m/g, '');
}

function visibleLength(text) {
  return stripAnsi(text).length;
}

function terminalWidth() {
  return Math.max(64, Math.min(process.stdout.columns || 88, 120));
}

function truncate(text, maxLength) {
  const value = String(text);
  if (visibleLength(value) <= maxLength) return value;
  if (maxLength <= 1) return value.slice(0, maxLength);
  return `${value.slice(0, Math.max(0, maxLength - 1))}~`;
}

function padRight(text, width) {
  return `${text}${' '.repeat(Math.max(0, width - visibleLength(text)))}`;
}

function rule(label = '') {
  const width = terminalWidth();
  if (!label) return paint('dim', '-'.repeat(width));
  const text = ` ${label} `;
  return paint('dim', `${text}${'-'.repeat(Math.max(0, width - visibleLength(text)))}`);
}

function line(label, value) {
  return `${paint('dim', `${label}:`)} ${value}`;
}

function printBox(title, rows, tone = 'cyan') {
  const width = terminalWidth();
  const border = '-'.repeat(width - 2);
  console.log(paint('dim', `+${border}+`));
  console.log(`${paint(tone, '|')} ${paint('bold', truncate(title, width - 4))}${' '.repeat(Math.max(0, width - 4 - visibleLength(title)))} ${paint(tone, '|')}`);
  for (const row of rows) {
    const chunks = String(row).split('\n');
    for (const chunk of chunks) {
      const content = truncate(chunk, width - 4);
      console.log(`${paint('dim', '|')} ${padRight(content, width - 4)} ${paint('dim', '|')}`);
    }
  }
  console.log(paint('dim', `+${border}+`));
}

function compactPath(value) {
  const home = homedir();
  const text = String(value);
  return text.startsWith(home) ? `~${text.slice(home.length)}` : text;
}

function commandList(rows) {
  const width = terminalWidth();
  const commandWidth = Math.min(24, Math.max(16, ...rows.map((row) => row[0].length + 2)));
  return rows.map(([command, description]) => {
    const left = padRight(paint('cyan', command), commandWidth);
    return `${left}${truncate(description, width - commandWidth - 2)}`;
  });
}

function usage() {
  printBox('murph agent', [
    'Usage: murph agent [prompt] [options]',
    '',
    ...commandList([
      ['--provider NAME', 'Model provider. Defaults to OpenAI when OPENAI_API_KEY exists, then Anthropic.'],
      ['--model NAME', 'Model id. Defaults to MURPH_AGENT_MODEL or the provider default.'],
      ['--no-session', 'Use an in-memory session for this run.'],
      ['--no-server', 'Do not auto-start Murph\'s local HTTP server.'],
      ['--continue', 'Continue the most recent Murph agent session.'],
      ['--source-edits', 'Allow direct Murph source edits for this run.'],
      ['--verbose-tools', 'Show every tool request and execution event.'],
      ['--help', 'Show this help.']
    ])
  ]);
}

function loadEnv() {
  const envPath = path.join(appDir, '.env');
  if (!existsSync(envPath)) {
    return;
  }

  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) {
      continue;
    }
    const idx = trimmed.indexOf('=');
    const key = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1).trim().replace(/^['"]|['"]$/g, '');
    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

function parseArgs(argv) {
  const options = {};
  const prompt = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else if (arg === '--provider') {
      options.provider = argv[++i];
    } else if (arg === '--model') {
      options.model = argv[++i];
    } else if (arg === '--no-session') {
      options.noSession = true;
    } else if (arg === '--no-server') {
      options.noServer = true;
    } else if (arg === '--continue') {
      options.continueSession = true;
    } else if (arg === '--source-edits') {
      options.sourceEdits = true;
    } else if (arg === '--verbose-tools') {
      options.verboseTools = true;
    } else {
      prompt.push(arg);
    }
  }
  return { options, prompt: prompt.join(' ').trim() };
}

function defaultProvider() {
  if (process.env.MURPH_AGENT_PROVIDER) return process.env.MURPH_AGENT_PROVIDER;
  if (process.env.OPENAI_API_KEY) return 'openai';
  if (process.env.ANTHROPIC_API_KEY) return 'anthropic';
  return 'openai';
}

function defaultModel(provider) {
  if (process.env.MURPH_AGENT_MODEL) return process.env.MURPH_AGENT_MODEL;
  return provider === 'anthropic' ? 'claude-sonnet-4-6' : 'gpt-5.4-mini';
}

function apiKeyFor(provider) {
  if (provider === 'anthropic') return process.env.ANTHROPIC_API_KEY;
  if (provider === 'openai') return process.env.OPENAI_API_KEY;
  return process.env[`${provider.toUpperCase().replaceAll('-', '_')}_API_KEY`];
}

function sessionDirForCwd(cwd) {
  const safePath = `--${cwd.replace(/^[/\\]/, '').replace(/[/\\:]/g, '-')}--`;
  return path.join(agentDir, 'sessions', safePath);
}

function expandHome(value) {
  if (value === '~') return homedir();
  if (value.startsWith('~/')) return path.join(homedir(), value.slice(2));
  return value;
}

function resolvePathForTool(value) {
  const expanded = expandHome(String(value || ''));
  return path.resolve(appDir, expanded);
}

function isWithin(candidate, root) {
  const resolved = path.resolve(candidate);
  const resolvedRoot = path.resolve(root);
  return resolved === resolvedRoot || resolved.startsWith(`${resolvedRoot}${path.sep}`);
}

function allowedWriteRoots() {
  return [
    path.join(murphHome, 'plugins'),
    path.join(appDir, 'plugins'),
    path.join(appDir, 'policies'),
    path.join(appDir, 'skills')
  ];
}

function allowedWriteFiles() {
  return [
    path.join(appDir, '.env'),
    path.join(appDir, '.env.example')
  ];
}

function isAllowedPluginOrConfigPath(absolutePath) {
  return allowedWriteRoots().some((root) => isWithin(absolutePath, root)) ||
    allowedWriteFiles().some((filePath) => path.resolve(filePath) === path.resolve(absolutePath));
}

function bashLooksSourceMutating(command) {
  const normalized = command.trim().toLowerCase();
  return /\b(sed|perl)\b.*\s-i\b/.test(normalized) ||
    /\btee\b/.test(normalized) ||
    /(^|\s)>/.test(normalized) ||
    /\b(npm|pnpm|yarn)\s+(install|add|remove|update)\b/.test(normalized) ||
    /\bgit\s+(reset|checkout|clean|rebase|merge|pull|push|commit|apply)\b/.test(normalized);
}

function bashLooksHardBlocked(command) {
  const normalized = command.trim().toLowerCase();
  return /\bsudo\b/.test(normalized) ||
    /\brm\s+(-rf|-fr|--recursive)\b/.test(normalized) ||
    /\bchmod\b/.test(normalized) ||
    /\bchown\b/.test(normalized) ||
    /\bdd\s+/.test(normalized) ||
    /\bcurl\b.*\|\s*(bash|sh)\b/.test(normalized);
}

function bashNeedsApproval(command) {
  return bashLooksSourceMutating(command);
}

async function requestJson(method, pathname, body) {
  const url = `${murphUrl}${pathname}`;
  let response;
  try {
    response = await fetch(url, {
      method,
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
  } catch (error) {
    throw new Error(`Murph server is not reachable at ${murphUrl}: ${error instanceof Error ? error.message : String(error)}`);
  }

  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) {
    throw new Error(payload.error || `${method} ${pathname} failed with ${response.status}`);
  }
  return payload;
}

async function requestJsonTool(method, pathname, body) {
  try {
    return textResult(await requestJson(method, pathname, body));
  } catch (error) {
    return textResult({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      hint: `Run murph start --background or restart with murph restart if ${murphUrl} should be available.`
    });
  }
}

function textResult(details, terminate = false) {
  return {
    content: [{ type: 'text', text: JSON.stringify(details, null, 2) }],
    details,
    terminate
  };
}

async function confirmTool(toolName, args) {
  console.log('');
  printBox('approval required', [
    line('tool', paint('yellow', toolName)),
    '',
    ...JSON.stringify(args, null, 2).split('\n').map((row) => paint('dim', row))
  ], 'yellow');
  const answer = await rl.question(`${paint('yellow', 'apply change?')} ${paint('dim', '[y/N]')} `);
  return answer.trim().toLowerCase() === 'y' || answer.trim().toLowerCase() === 'yes';
}

function safePluginId(raw) {
  const id = String(raw || '').trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(id)) {
    throw new Error(`Invalid plugin id: ${raw || '<empty>'}`);
  }
  return id;
}

function ensureUnderRoot(root, candidate) {
  const rootPath = path.resolve(root);
  const resolved = path.resolve(candidate);
  if (resolved !== rootPath && !resolved.startsWith(`${rootPath}${path.sep}`)) {
    throw new Error(`Path escapes plugin root: ${candidate}`);
  }
  return resolved;
}

function scaffoldPlugin(params) {
  const id = safePluginId(params.id);
  const root = path.join(murphHome, 'plugins', id);
  if (existsSync(root)) {
    throw new Error(`Plugin already exists: ${root}`);
  }

  const includeSkill = params.includeSkill !== false;
  const includeAdapter = params.includeAdapter !== false;
  const name = params.name || id;
  const description = params.description || `${name} plugin for Murph.`;
  const capabilities = { skills: [], adapters: [] };

  mkdirSync(root, { recursive: true });

  if (includeSkill) {
    const skillDir = ensureUnderRoot(root, path.join(root, 'skills'));
    mkdirSync(skillDir, { recursive: true });
    const skillPath = path.join(skillDir, `${id}.md`);
    writeFileSync(skillPath, [
      '---',
      `name: ${id}`,
      `description: ${description}`,
      'knowledgeDomains: [integration]',
      'priority: 10',
      '---',
      `Use this skill when the user asks about ${name}.`,
      '',
      'Prefer grounded answers from adapter context sources and tools before giving setup guidance.'
    ].join('\n'));
    capabilities.skills.push(`skills/${id}.md`);
  }

  if (includeAdapter) {
    const adapterDir = ensureUnderRoot(root, path.join(root, 'adapters'));
    mkdirSync(adapterDir, { recursive: true });
    const adapterPath = path.join(adapterDir, `${id}.mjs`);
    const envKey = `${id.toUpperCase().replace(/[^A-Z0-9]/g, '_')}_API_KEY`;
    writeFileSync(adapterPath, `export default {
  id: '${id}',
  name: '${name}',
  description: '${description}',
  credential: {
    authType: 'api_key',
    credentialKind: 'api_key',
    envKey: '${envKey}',
    credentialLabel: 'API key'
  },
  tools: [],
  contextSources: [],
  isConfigured() {
    return Boolean(process.env.${envKey});
  }
};
`);
    capabilities.adapters.push(`adapters/${id}.mjs`);
  }

  writeFileSync(path.join(root, 'plugin.json'), JSON.stringify({
    id,
    name,
    description,
    version: '0.1.0',
    capabilities
  }, null, 2));

  return { root, manifest: path.join(root, 'plugin.json'), capabilities };
}

function validatePluginRoot(pluginRoot) {
  const root = path.resolve(pluginRoot);
  const manifestPath = path.join(root, 'plugin.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const capabilities = manifest.capabilities || {};
  const paths = [...(capabilities.skills || []), ...(capabilities.adapters || [])];

  if (!manifest.id || !/^[a-z0-9][a-z0-9._-]*$/i.test(manifest.id)) {
    throw new Error('plugin.json has an invalid id');
  }
  if (!manifest.name || !manifest.description) {
    throw new Error('plugin.json requires name and description');
  }
  if (paths.length === 0) {
    throw new Error('plugin.json must declare at least one skill or adapter');
  }
  for (const relativePath of paths) {
    const target = ensureUnderRoot(root, path.join(root, relativePath));
    if (!existsSync(target)) {
      throw new Error(`Missing plugin file: ${relativePath}`);
    }
  }
  return { ok: true, root, id: manifest.id, capabilities };
}

function runSetupSection(section) {
  const result = spawnSync(process.execPath, [path.join(appDir, 'bin/setup-cli.mjs'), section || 'all'], {
    cwd: appDir,
    stdio: 'pipe',
    encoding: 'utf8',
    env: process.env
  });
  return {
    exitCode: result.status ?? 1,
    stdout: result.stdout.trim(),
    stderr: result.stderr.trim()
  };
}

async function promptCredential(provider) {
  console.log('');
  printBox('credential required', [
    line('provider', paint('yellow', provider)),
    'The credential is sent directly to Murph and is not included in the model transcript.'
  ], 'yellow');
  const credential = await rl.question(`${paint('yellow', 'credential')} ${paint('dim', '>')} `);
  return credential.trim();
}

function createMurphTools() {
  return [
    defineTool({
      name: 'murph_setup_status',
      label: 'Murph setup status',
      description: 'Read Murph setup readiness from the running server.',
      promptSnippet: 'murph_setup_status: inspect Murph setup readiness.',
      parameters: Type.Object({}),
      execute: async () => requestJsonTool('GET', '/api/setup/status')
    }),
    defineTool({
      name: 'murph_setup_doctor',
      label: 'Murph setup doctor',
      description: 'Read the detailed Murph setup doctor result.',
      promptSnippet: 'murph_setup_doctor: inspect detailed setup diagnostics.',
      parameters: Type.Object({}),
      execute: async () => requestJsonTool('GET', '/api/setup/doctor')
    }),
    defineTool({
      name: 'murph_runtime_health',
      label: 'Murph health',
      description: 'Read Murph server health.',
      promptSnippet: 'murph_runtime_health: check whether the Murph server is responding.',
      parameters: Type.Object({}),
      execute: async () => requestJsonTool('GET', '/api/health')
    }),
    defineTool({
      name: 'murph_integration_status',
      label: 'Murph integration status',
      description: 'Read Murph integration status.',
      promptSnippet: 'murph_integration_status: inspect configured integrations.',
      parameters: Type.Object({}),
      execute: async () => requestJsonTool('GET', '/api/integrations/status')
    }),
    defineTool({
      name: 'murph_integration_connect',
      label: 'Connect Murph integration',
      description: 'Prompt locally for a credential and connect a Murph integration.',
      promptSnippet: 'murph_integration_connect: connect an integration using a local credential prompt.',
      parameters: Type.Object({
        provider: Type.String({ description: 'Provider id, such as github, notion, or granola.' })
      }),
      executionMode: 'sequential',
      execute: async (_toolCallId, params) => {
        const credential = await promptCredential(params.provider);
        if (!credential) {
          throw new Error('credential_required');
        }
        return requestJsonTool('POST', `/api/integrations/${encodeURIComponent(params.provider)}/connect`, { credential });
      }
    }),
    defineTool({
      name: 'murph_plugin_status',
      label: 'Murph plugin status',
      description: 'Read scoped Murph plugin load status.',
      promptSnippet: 'murph_plugin_status: inspect scoped plugin load status.',
      parameters: Type.Object({}),
      execute: async () => requestJsonTool('GET', '/api/plugins/status')
    }),
    defineTool({
      name: 'murph_plugin_create_draft',
      label: 'Create Murph plugin draft',
      description: 'Create a scoped Murph plugin draft under ~/.murph/plugins.',
      promptSnippet: 'murph_plugin_create_draft: create a scoped skill/adapter plugin package.',
      parameters: Type.Object({
        id: Type.String(),
        name: Type.Optional(Type.String()),
        description: Type.Optional(Type.String()),
        includeSkill: Type.Optional(Type.Boolean()),
        includeAdapter: Type.Optional(Type.Boolean())
      }),
      executionMode: 'sequential',
      execute: async (_toolCallId, params) => textResult(scaffoldPlugin(params))
    }),
    defineTool({
      name: 'murph_plugin_validate',
      label: 'Validate Murph plugin',
      description: 'Run local manifest and path validation for a scoped plugin package.',
      promptSnippet: 'murph_plugin_validate: validate a scoped plugin package.',
      parameters: Type.Object({
        root: Type.String({ description: 'Absolute plugin root, or a plugin id under ~/.murph/plugins.' })
      }),
      execute: async (_toolCallId, params) => {
        const root = path.isAbsolute(params.root) ? params.root : path.join(murphHome, 'plugins', params.root);
        return textResult(validatePluginRoot(root));
      }
    }),
    defineTool({
      name: 'murph_plugin_install',
      label: 'Install Murph plugin',
      description: 'Validate a scoped plugin package and reload plugins in the running server.',
      promptSnippet: 'murph_plugin_install: validate and reload scoped plugins.',
      parameters: Type.Object({
        root: Type.String({ description: 'Absolute plugin root, or a plugin id under ~/.murph/plugins.' })
      }),
      executionMode: 'sequential',
      execute: async (_toolCallId, params) => {
        try {
          const root = path.isAbsolute(params.root) ? params.root : path.join(murphHome, 'plugins', params.root);
          const validation = validatePluginRoot(root);
          const reload = await requestJson('POST', '/api/plugins/reload');
          return textResult({ validation, reload });
        } catch (error) {
          return textResult({
            ok: false,
            error: error instanceof Error ? error.message : String(error),
            hint: `Validate the plugin path and make sure Murph is running at ${murphUrl}.`
          });
        }
      }
    }),
    defineTool({
      name: 'murph_plugin_reload',
      label: 'Reload Murph plugins',
      description: 'Reload scoped Murph plugins in the running server.',
      promptSnippet: 'murph_plugin_reload: reload scoped plugin packages.',
      parameters: Type.Object({}),
      executionMode: 'sequential',
      execute: async () => requestJsonTool('POST', '/api/plugins/reload')
    }),
    defineTool({
      name: 'murph_policy_profiles',
      label: 'Murph policy profiles',
      description: 'List available Murph policy profiles.',
      promptSnippet: 'murph_policy_profiles: list available policy profiles.',
      parameters: Type.Object({}),
      execute: async () => requestJsonTool('GET', '/api/gateway/policy-profiles')
    }),
    defineTool({
      name: 'murph_policy_get',
      label: 'Murph policy config',
      description: 'Read Murph local policy configuration.',
      promptSnippet: 'murph_policy_get: inspect selected policy profile/config.',
      parameters: Type.Object({}),
      execute: async () => requestJsonTool('GET', '/api/gateway/policy/config')
    }),
    defineTool({
      name: 'murph_policy_preview',
      label: 'Preview Murph policy',
      description: 'Preview an effective Murph policy profile and optional override.',
      promptSnippet: 'murph_policy_preview: preview policy changes before saving.',
      parameters: Type.Object({
        profileName: Type.Optional(Type.String()),
        overrideRaw: Type.Optional(Type.String()),
        sessionMode: Type.Optional(Type.String())
      }),
      execute: async (_toolCallId, params) => requestJsonTool('POST', '/api/gateway/policy/preview', params)
    }),
    defineTool({
      name: 'murph_policy_set',
      label: 'Set Murph policy',
      description: 'Set Murph local policy profile.',
      promptSnippet: 'murph_policy_set: save the selected policy profile.',
      parameters: Type.Object({
        profileName: Type.String()
      }),
      executionMode: 'sequential',
      execute: async (_toolCallId, params) => requestJsonTool('PUT', '/api/gateway/policy/config', params)
    })
  ];
}

function createGuardExtension(state) {
  return (pi) => {
    pi.on('tool_call', async (event) => {
      if (event.toolName === 'write' || event.toolName === 'edit') {
        const target = resolvePathForTool(event.input.path);
        if (!state.sourceEdits && !isAllowedPluginOrConfigPath(target)) {
          return {
            block: true,
            reason: `Direct source edits are disabled for this run. Use --source-edits to modify ${target}.`
          };
        }
      }

      if (event.toolName === 'bash') {
        const command = String(event.input.command || '');
        if (bashLooksHardBlocked(command)) {
          return { block: true, reason: 'Command is blocked by Murph agent safety policy.' };
        }
        if (!state.sourceEdits && bashLooksSourceMutating(command)) {
          return {
            block: true,
            reason: 'This command appears to mutate source or dependencies. Use --source-edits for this run if that is intended.'
          };
        }
        if (state.sourceEdits && bashNeedsApproval(command)) {
          const approved = await confirmTool(event.toolName, event.input);
          return approved ? undefined : { block: true, reason: 'User declined tool execution.' };
        }
        return undefined;
      }

      if (!MUTATING_TOOLS.has(event.toolName)) {
        return undefined;
      }

      const approved = await confirmTool(event.toolName, event.input);
      return approved ? undefined : { block: true, reason: 'User declined tool execution.' };
    });
  };
}

function murphSystemPrompt(sourceEdits) {
  return [
    'You are Murph Agent, a user-facing Pi coding agent embedded in the Murph CLI.',
    'Your job is to help the local operator set up Murph, debug Murph, build scoped integrations, create skills/adapters, and adjust policy configuration.',
    'Murph async Slack/Discord runtime is separate. Do not present yourself as the async runtime brain.',
    'Prefer Murph custom tools for setup, integration status, plugin reload, and policy changes before editing files by hand.',
    'For new capabilities, prefer scoped plugin packages under ~/.murph/plugins/<id> with plugin.json, skills/*.md, and adapters/*.mjs.',
    'Installed runtime plugin adapters must remain read-only in v1. Do not add external-write adapter tools to scoped plugins.',
    sourceEdits
      ? 'This run explicitly allows Murph source edits. Keep changes focused and validate them.'
      : 'Default write scope is Plugin+Config. Do not modify Murph source files unless the operator restarts with --source-edits or explicitly asks for source edits.',
    'Never ask the user to paste credentials into chat. Use credential tools that prompt locally.'
  ].join('\n');
}

function assistantText(message) {
  if (!message || message.role !== 'assistant') {
    return '';
  }
  return message.content
    .filter((item) => item.type === 'text')
    .map((item) => item.text)
    .join('');
}

function toolCallNames(message) {
  if (!message || message.role !== 'assistant') {
    return [];
  }
  return message.content
    .filter((item) => item.type === 'toolCall')
    .map((item) => item.name);
}

function toolErrorText(result) {
  const value = result?.details ?? result;
  if (!value) return 'unknown error';
  if (typeof value === 'string') return value;
  if (value.error) return String(value.error);
  if (value.message) return String(value.message);
  const contentText = value.content
    ?.filter((item) => item?.type === 'text' && item.text)
    ?.map((item) => item.text)
    ?.join(' ');
  if (contentText) return contentText;
  const json = JSON.stringify(value);
  return json && json !== '{}' ? json : 'unknown error';
}

function formatToolName(name) {
  if (name.startsWith('murph_')) return paint('magenta', name);
  return paint('blue', name);
}

function printStartup({ provider, modelId, sessionFile, sourceEdits, modelFallbackMessage }) {
  const rows = [
    `${line('model', paint('bold', `${provider}/${modelId}`))}    ${line('cwd', compactPath(appDir))}`,
    `${line('session', sessionFile ? compactPath(sessionFile) : 'in-memory')}    ${line('server', murphUrl)}`,
    `${line('write scope', sourceEdits ? paint('yellow', 'source edits enabled') : paint('green', 'plugin+config'))}    ${line('commands', '/help /tools /status /quit')}`
  ];
  printBox('Murph Agent', rows, 'cyan');
  if (modelFallbackMessage) {
    console.log(`${paint('yellow', 'notice')} ${modelFallbackMessage}`);
  }
}

function printAgentHelp() {
  printBox('commands', commandList([
    ['/status', 'Read plugin/runtime status from the local Murph server.'],
    ['/tools', 'Show active Pi and Murph tools.'],
    ['/tool-log on', 'Show every tool request and execution event.'],
    ['/tool-log off', 'Hide routine tool activity.'],
    ['/source-edits on', 'Allow direct Murph source edits for this session.'],
    ['/source-edits off', 'Return to plugin+config write scope.'],
    ['/help', 'Show this command reference.'],
    ['/quit', 'Exit the agent.']
  ]));
}

function printTools(toolNames) {
  const groups = [
    ['Core tools', toolNames.filter((name) => !name.startsWith('murph_'))],
    ['Murph tools', toolNames.filter((name) => name.startsWith('murph_'))]
  ];
  const rows = [];
  for (const [title, names] of groups) {
    if (rows.length) rows.push('');
    rows.push(paint('bold', title));
    for (const name of names) {
      rows.push(`  ${formatToolName(name)}`);
    }
  }
  printBox('active tools', rows);
}

function printJsonPanel(title, value) {
  printBox(title, JSON.stringify(value, null, 2).split('\n').map((row) => paint('dim', row)));
}

function printError(title, error) {
  const message = error instanceof Error ? error.message : String(error);
  printBox(title, [message], 'red');
}

async function createSessionManager(options) {
  if (options.noSession) {
    return SessionManager.inMemory(appDir);
  }
  const dir = sessionDirForCwd(appDir);
  return options.continueSession
    ? SessionManager.continueRecent(appDir, dir)
    : SessionManager.create(appDir, dir);
}

async function runAgent(initialPrompt, options) {
  loadEnv();
  const provider = options.provider || defaultProvider();
  const modelId = options.model || defaultModel(provider);
  const apiKey = apiKeyFor(provider);
  if (!apiKey) {
    throw new Error(`Missing API key for ${provider}. Run murph setup ai or set MURPH_AGENT_PROVIDER/MURPH_AGENT_MODEL.`);
  }

  mkdirSync(agentDir, { recursive: true });
  const authStorage = AuthStorage.create(path.join(agentDir, 'auth.json'));
  authStorage.setRuntimeApiKey(provider, apiKey);
  const modelRegistry = ModelRegistry.create(authStorage, path.join(agentDir, 'models.json'));
  const model = getModel(provider, modelId);
  const settingsManager = undefined;
  const guardState = { sourceEdits: Boolean(options.sourceEdits) };
  const resourceLoader = new DefaultResourceLoader({
    cwd: appDir,
    agentDir,
    appendSystemPrompt: [murphSystemPrompt(guardState.sourceEdits)],
    extensionFactories: [createGuardExtension(guardState)],
    agentsFilesOverride: (base) => ({
      agentsFiles: [
        ...base.agentsFiles,
        {
          path: '<murph-agent-contract>',
          content: murphSystemPrompt(guardState.sourceEdits)
        }
      ]
    })
  });
  await resourceLoader.reload();

  const sessionManager = await createSessionManager(options);
  const { session, modelFallbackMessage } = await createAgentSession({
    cwd: appDir,
    agentDir,
    authStorage,
    modelRegistry,
    model,
    thinkingLevel: 'medium',
    resourceLoader,
    sessionManager,
    settingsManager,
    customTools: createMurphTools(),
    tools: ['read', 'bash', 'edit', 'write', 'grep', 'find', 'ls', ...CUSTOM_TOOL_NAMES]
  });

  let assistantLineOpen = false;
  let assistantPrintedText = false;
  let verboseTools = Boolean(options.verboseTools || process.env.MURPH_AGENT_VERBOSE_TOOLS);
  let turnToolFailures = [];
  const printedErrors = new Set();

  function printModelError(message) {
    const key = `${message.timestamp}:${message.errorMessage}`;
    if (printedErrors.has(key)) {
      return;
    }
    printedErrors.add(key);
    if (assistantLineOpen) {
      process.stdout.write('\n');
      assistantLineOpen = false;
    }
    console.log(`${paint('red', 'model error')} ${message.errorMessage}`);
  }

  function flushToolFailures() {
    if (turnToolFailures.length === 0) {
      return;
    }
    const summary = turnToolFailures
      .map((failure) => `${failure.name}: ${failure.error}`)
      .join(' | ');
    console.log(`${paint('red', 'tool issue')} ${truncate(summary, terminalWidth() - 12)}`);
    turnToolFailures = [];
  }

  session.subscribe((event) => {
    if (event.type === 'message_update' && event.assistantMessageEvent?.type === 'text_delta') {
      if (!assistantLineOpen) {
        flushToolFailures();
        process.stdout.write(`\n${paint('cyan', 'murph')} ${paint('dim', '<')} `);
        assistantLineOpen = true;
      }
      assistantPrintedText = true;
      process.stdout.write(event.assistantMessageEvent.delta);
    }
    if (event.type === 'tool_execution_start') {
      if (verboseTools) {
        if (assistantLineOpen) {
          process.stdout.write('\n');
          assistantLineOpen = false;
        }
        console.log(`${paint('dim', 'tool')} ${formatToolName(event.toolName)} ${paint('dim', 'running')}`);
      }
    }
    if (event.type === 'tool_execution_end' && event.isError) {
      const error = toolErrorText(event.result);
      turnToolFailures.push({ name: event.toolName, error });
      if (verboseTools) {
        console.log(`${paint('red', 'tool error')} ${event.toolName}: ${error}`);
      }
    }
    if (event.type === 'message_end') {
      const text = assistantText(event.message);
      const calls = toolCallNames(event.message);
      if (event.message.role === 'assistant' && event.message.errorMessage) {
        printModelError(event.message);
        return;
      }
      if (assistantLineOpen) {
        process.stdout.write('\n');
        assistantLineOpen = false;
        return;
      }
      flushToolFailures();
      if (text.trim() && !assistantPrintedText) {
        console.log(`\n${paint('cyan', 'murph')} ${paint('dim', '<')} ${text.trim()}\n`);
      } else if (calls.length > 0 && verboseTools) {
        console.log(`${paint('dim', 'requested')} ${calls.map(formatToolName).join(paint('dim', ', '))}`);
      }
    }
    if (event.type === 'agent_end') {
      for (const message of event.messages ?? []) {
        if (message.role === 'assistant' && message.errorMessage) {
          printModelError(message);
        }
      }
    }
    if (event.type === 'turn_start') {
      assistantPrintedText = false;
      turnToolFailures = [];
    }
  });

  printStartup({
    provider,
    modelId,
    sessionFile: session.sessionFile,
    sourceEdits: guardState.sourceEdits,
    modelFallbackMessage
  });

  if (initialPrompt) {
    await session.prompt(initialPrompt);
    return;
  }

  while (true) {
    const prompt = await rl.question(`\n${paint('cyan', 'murph')} ${paint('dim', '>')} `);
    const trimmed = prompt.trim();
    if (!trimmed) continue;
    if (trimmed === '/quit' || trimmed === '/exit') break;
    if (trimmed === '/help') {
      printAgentHelp();
      continue;
    }
    if (trimmed === '/status') {
      try {
        printJsonPanel('plugin status', await requestJson('GET', '/api/plugins/status'));
      } catch (error) {
        printError('server unavailable', error);
      }
      continue;
    }
    if (trimmed === '/tools') {
      printTools(session.getActiveToolNames());
      continue;
    }
    if (trimmed === '/tool-log on') {
      verboseTools = true;
      console.log(`${paint('blue', 'tool log')} verbose tool activity enabled`);
      continue;
    }
    if (trimmed === '/tool-log off') {
      verboseTools = false;
      console.log(`${paint('blue', 'tool log')} routine tool activity hidden`);
      continue;
    }
    if (trimmed === '/source-edits on') {
      guardState.sourceEdits = true;
      console.log(`${paint('yellow', 'write scope')} source edits enabled for this session`);
      continue;
    }
    if (trimmed === '/source-edits off') {
      guardState.sourceEdits = false;
      console.log(`${paint('green', 'write scope')} plugin+config restored`);
      continue;
    }
    await session.prompt(trimmed);
  }
}

const { options, prompt } = parseArgs(process.argv.slice(2));
if (options.help) {
  usage();
  process.exit(0);
}

runAgent(prompt, options).catch((error) => {
  printError('agent failed', error);
  process.exitCode = 1;
}).finally(() => {
  rl.close();
});
