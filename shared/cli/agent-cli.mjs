#!/usr/bin/env node
import {
    existsSync,
    mkdirSync,
    readdirSync,
    readFileSync,
    statSync,
    writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { main as runPiMain, defineTool } from '@mariozechner/pi-coding-agent';
import { Type } from 'typebox';
import { parse } from 'yaml';

const appDir = path.resolve(process.env.MURPH_APP_DIR || process.cwd());
const murphHome = process.env.MURPH_HOME || path.join(homedir(), '.murph');
const configPath = process.env.MURPH_CONFIG_PATH || path.join(murphHome, 'config.yaml');
const credentialsPath =
    process.env.MURPH_CREDENTIALS_PATH || path.join(murphHome, '.credentials');
const agentDir =
    process.env.MURPH_AGENT_DIR || path.join(murphHome, 'pi-agent');
const bundledAgentSkillsDir = path.join(appDir, 'skills', 'agent');
const activeAgentSkillsDir = path.join(agentDir, 'skills');
const murphUrl =
    process.env.MURPH_URL ||
    `http://localhost:${process.env.MURPH_PORT || '5173'}`;
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
    red: useColor ? '\x1b[31m' : '',
};

const CUSTOM_TOOL_NAMES = [
    'murph_product_context',
    'murph_setup_status',
    'murph_setup_doctor',
    'murph_runtime_health',
    'murph_docs_search',
    'murph_architecture_search',
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
    'murph_policy_set',
];

const DEFAULT_TOOL_NAMES = [
    'read',
    'bash',
    'edit',
    'write',
    'grep',
    'find',
    'ls',
    ...CUSTOM_TOOL_NAMES,
];

const DEFAULT_PROVIDER_MODEL = {
    openai: 'gpt-5.5',
    anthropic: 'claude-opus-4-7',
};

const MUTATING_TOOLS = new Set([
    'edit',
    'write',
    'murph_integration_connect',
    'murph_plugin_create_draft',
    'murph_plugin_install',
    'murph_plugin_reload',
    'murph_policy_set',
]);

const PI_FLAGS_WITH_VALUE = new Set([
    '--api-key',
    '--append-system-prompt',
    '--extension',
    '-e',
    '--fork',
    '--mode',
    '--models',
    '--prompt-template',
    '--session',
    '--session-dir',
    '--skill',
    '--system-prompt',
    '--theme',
    '--tools',
    '-t',
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

function line(label, value) {
    return `${paint('dim', `${label}:`)} ${value}`;
}

function printBox(title, rows, tone = 'cyan') {
    const width = terminalWidth();
    const border = '-'.repeat(width - 2);
    console.log(paint('dim', `+${border}+`));
    console.log(
        `${paint(tone, '|')} ${paint('bold', truncate(title, width - 4))}${' '.repeat(Math.max(0, width - 4 - visibleLength(title)))} ${paint(tone, '|')}`,
    );
    for (const row of rows) {
        const chunks = String(row).split('\n');
        for (const chunk of chunks) {
            const content = truncate(chunk, width - 4);
            console.log(
                `${paint('dim', '|')} ${padRight(content, width - 4)} ${paint('dim', '|')}`,
            );
        }
    }
    console.log(paint('dim', `+${border}+`));
}

function commandList(rows) {
    const width = terminalWidth();
    const commandWidth = Math.min(
        28,
        Math.max(16, ...rows.map((row) => row[0].length + 2)),
    );
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
            [
                '--provider NAME',
                'Model provider. Defaults to config.yaml agent/runtime defaults.',
            ],
            [
                '--model NAME',
                'Model id. Defaults to config.yaml agent/runtime defaults.',
            ],
            [
                '--thinking LEVEL',
                'Thinking level. Defaults to low, or medium with --source-edits.',
            ],
            [
                '--print, -p',
                'Run one-shot text mode instead of the fullscreen chat TUI.',
            ],
            ['--no-session', 'Use an in-memory session for this run.'],
            ['--continue', 'Continue the most recent Murph agent session.'],
            ['--source-edits', 'Allow direct Murph source edits for this run.'],
            ['--verbose-tools', 'Start with expanded tool output.'],
            ['--help', 'Show this help.'],
        ]),
    ]);
}

function loadConfig() {
    if (!existsSync(configPath)) return {};
    const parsed = parse(readFileSync(configPath, 'utf8')) ?? {};
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? parsed
        : {};
}

function configString(parts) {
    let cursor = loadConfig();
    for (const part of parts) {
        if (!cursor || typeof cursor !== 'object' || Array.isArray(cursor))
            return undefined;
        cursor = cursor[part];
    }
    return typeof cursor === 'string' && cursor.trim()
        ? cursor.trim()
        : undefined;
}

function credentialValue(provider, key) {
    if (!existsSync(credentialsPath)) return undefined;
    try {
        const parsed = JSON.parse(readFileSync(credentialsPath, 'utf8'));
        const entry = (Array.isArray(parsed.credentials)
            ? parsed.credentials
            : []
        ).find(
            (item) =>
                item?.provider === provider &&
                item?.key === key &&
                !item?.workspaceId &&
                !item?.userId,
        );
        return typeof entry?.value === 'string' && entry.value.trim()
            ? entry.value.trim()
            : undefined;
    } catch {
        return undefined;
    }
}

function parseArgs(argv) {
    const options = {};
    const prompt = [];
    const passthrough = [];

    for (let i = 0; i < argv.length; i += 1) {
        const arg = argv[i];
        if (arg === '--help' || arg === '-h') {
            options.help = true;
        } else if (arg === '--provider') {
            options.provider = argv[++i];
        } else if (arg === '--model') {
            options.model = argv[++i];
        } else if (arg === '--thinking') {
            options.thinking = argv[++i];
        } else if (arg === '--no-session') {
            options.noSession = true;
        } else if (arg === '--no-server') {
            options.unsupportedOption = arg;
        } else if (arg === '--continue' || arg === '-c') {
            options.continueSession = true;
        } else if (arg === '--source-edits') {
            options.sourceEdits = true;
        } else if (arg === '--verbose-tools') {
            options.verboseTools = true;
        } else if (arg === '--print' || arg === '-p') {
            options.print = true;
        } else if (arg === '--version' || arg === '-v') {
            options.version = true;
        } else if (arg === '--list-models') {
            passthrough.push(arg);
            const next = argv[i + 1];
            if (
                next !== undefined &&
                !next.startsWith('-') &&
                !next.startsWith('@')
            ) {
                passthrough.push(argv[++i]);
            }
        } else if (arg.startsWith('--') || arg.startsWith('-')) {
            passthrough.push(arg);
            if (PI_FLAGS_WITH_VALUE.has(arg) && argv[i + 1] !== undefined) {
                passthrough.push(argv[++i]);
            }
        } else {
            prompt.push(arg);
        }
    }

    return { options, prompt: prompt.join(' ').trim(), passthrough };
}

function defaultProvider() {
    if (process.env.MURPH_AGENT_PROVIDER)
        return process.env.MURPH_AGENT_PROVIDER;
    const configured = configString(['ai', 'agent', 'provider']);
    if (configured) return configured;
    if (process.env.MURPH_DEFAULT_PROVIDER)
        return process.env.MURPH_DEFAULT_PROVIDER;
    const runtimeProvider = configString(['ai', 'defaultProvider']);
    if (runtimeProvider) return runtimeProvider;
    if (process.env.OPENAI_API_KEY || credentialValue('openai', 'api_key'))
        return 'openai';
    if (process.env.ANTHROPIC_API_KEY || credentialValue('anthropic', 'api_key'))
        return 'anthropic';
    return 'openai';
}

function defaultModel(provider) {
    if (process.env.MURPH_AGENT_MODEL) return process.env.MURPH_AGENT_MODEL;
    const configured = configString(['ai', 'agent', 'model']);
    if (configured) return configured;
    const runtimeProvider =
        process.env.MURPH_DEFAULT_PROVIDER ||
        configString(['ai', 'defaultProvider']) ||
        provider;
    if (provider === runtimeProvider && process.env.MURPH_DEFAULT_MODEL)
        return process.env.MURPH_DEFAULT_MODEL;
    const runtimeModel = configString(['ai', 'defaultModel']);
    if (provider === runtimeProvider && runtimeModel) return runtimeModel;
    return DEFAULT_PROVIDER_MODEL[provider] || DEFAULT_PROVIDER_MODEL.openai;
}

function apiKeyFor(provider) {
    if (provider === 'anthropic')
        return (
            process.env.ANTHROPIC_API_KEY ||
            credentialValue('anthropic', 'api_key')
        );
    if (provider === 'openai')
        return process.env.OPENAI_API_KEY || credentialValue('openai', 'api_key');
    return (
        process.env[`${provider.toUpperCase().replaceAll('-', '_')}_API_KEY`] ||
        credentialValue(provider, 'api_key')
    );
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
    return (
        resolved === resolvedRoot ||
        resolved.startsWith(`${resolvedRoot}${path.sep}`)
    );
}

function allowedWriteRoots() {
    return [
        path.join(murphHome, 'plugins'),
        path.join(murphHome, 'policies'),
        path.join(murphHome, 'skills'),
    ];
}

function allowedWriteFiles() {
    return [configPath];
}

function isAllowedPluginOrConfigPath(absolutePath) {
    return (
        allowedWriteRoots().some((root) => isWithin(absolutePath, root)) ||
        allowedWriteFiles().some(
            (filePath) => path.resolve(filePath) === path.resolve(absolutePath),
        )
    );
}

function bashLooksSourceMutating(command) {
    const normalized = command.trim().toLowerCase();
    return (
        /\b(sed|perl)\b.*\s-i\b/.test(normalized) ||
        /\btee\b/.test(normalized) ||
        /(^|\s)>/.test(normalized) ||
        /\b(npm|pnpm|yarn)\s+(install|add|remove|update)\b/.test(normalized) ||
        /\bgit\s+(reset|checkout|clean|rebase|merge|pull|push|commit|apply)\b/.test(
            normalized,
        )
    );
}

function bashLooksHardBlocked(command) {
    const normalized = command.trim().toLowerCase();
    return (
        /\bsudo\b/.test(normalized) ||
        /\brm\s+(-rf|-fr|--recursive)\b/.test(normalized) ||
        /\bchmod\b/.test(normalized) ||
        /\bchown\b/.test(normalized) ||
        /\bdd\s+/.test(normalized) ||
        /\bcurl\b.*\|\s*(bash|sh)\b/.test(normalized)
    );
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
            headers: {
                ...(body === undefined ? {} : { 'content-type': 'application/json' }),
            },
            body: body === undefined ? undefined : JSON.stringify(body),
        });
    } catch (error) {
        throw new Error(
            `Murph server is not reachable at ${murphUrl}: ${error instanceof Error ? error.message : String(error)}`,
        );
    }

    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.ok === false) {
        throw new Error(
            payload.error ||
                `${method} ${pathname} failed with ${response.status}`,
        );
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
            hint: `Run murph start --background or restart with murph restart if ${murphUrl} should be available.`,
        });
    }
}

function textResult(details, terminate = false) {
    return {
        content: [{ type: 'text', text: JSON.stringify(details, null, 2) }],
        details,
        terminate,
    };
}

function activeDistribution() {
    return process.env.MURPH_DISTRIBUTION === 'personal' ? 'personal' : 'team';
}

function productContext(setupStatus) {
    const setupDistribution =
        setupStatus?.distribution === 'personal' || setupStatus?.distribution === 'team'
            ? setupStatus.distribution
            : undefined;
    const distribution = setupDistribution || activeDistribution();
    const personal = distribution === 'personal';
    return {
        distribution,
        product: personal ? 'Murph Personal' : 'Murph Team',
        productMode: setupStatus?.productMode || (personal ? 'personal' : 'channel'),
        runtimePurpose: personal
            ? 'Local/private runtime for one user.'
            : 'Shared host/channel runtime for team use.',
        runtimeUrl: murphUrl,
        appDir,
        murphHome,
        availableCapabilities: personal
            ? ['setup', 'local integrations', 'plugins', 'skills', 'policies', 'credentials']
            : ['setup', 'team integrations', 'plugins', 'skills', 'policies', 'admin dashboard'],
        unavailableCapabilities: personal
            ? ['team admin dashboard', 'team control-plane operations']
            : ['personal-local privacy guarantees', 'private-machine data access unless configured as an integration'],
        setupStatus: setupStatus
            ? {
                  reachable: true,
                  distribution: setupStatus.distribution,
                  productMode: setupStatus.productMode,
                  botRoles: setupStatus.botRoles,
                  rolesReady: setupStatus.rolesReady,
              }
            : { reachable: false },
    };
}

async function readProductContext() {
    try {
        return productContext(await requestJson('GET', '/api/setup/status'));
    } catch (error) {
        return {
            ...productContext(),
            setupStatus: {
                reachable: false,
                error: error instanceof Error ? error.message : String(error),
            },
        };
    }
}

function runtimeContextPrompt() {
    const context = productContext();
    return [
        `Active runtime: ${context.product}.`,
        `Runtime purpose: ${context.runtimePurpose}`,
        `Available capability groups: ${context.availableCapabilities.join(', ')}.`,
        `Unavailable in this runtime: ${context.unavailableCapabilities.join(', ')}.`,
    ].join('\n');
}

function clampLimit(value, fallback = 5) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(1, Math.min(20, Math.floor(parsed)));
}

function normalizeText(value) {
    return String(value || '').toLowerCase();
}

function queryTerms(query) {
    return normalizeText(query)
        .split(/[^a-z0-9_.-]+/i)
        .map((term) => term.trim())
        .filter((term) => term.length >= 2);
}

function filesUnder(root, extensions) {
    if (!existsSync(root)) return [];
    const stats = statSync(root);
    if (stats.isFile()) {
        return extensions.has(path.extname(root)) ? [root] : [];
    }
    if (!stats.isDirectory()) return [];

    const files = [];
    for (const entry of readdirSync(root, { withFileTypes: true })) {
        if (
            entry.name.startsWith('.') ||
            entry.name === 'node_modules' ||
            entry.name === 'dist' ||
            entry.name === '.vite'
        ) {
            continue;
        }
        const entryPath = path.join(root, entry.name);
        if (entry.isDirectory()) {
            files.push(...filesUnder(entryPath, extensions));
        } else if (entry.isFile() && extensions.has(path.extname(entry.name))) {
            files.push(entryPath);
        }
    }
    return files;
}

function copyDirectory(source, target) {
    mkdirSync(target, { recursive: true });
    for (const entry of readdirSync(source, { withFileTypes: true })) {
        const sourcePath = path.join(source, entry.name);
        const targetPath = path.join(target, entry.name);
        if (entry.isDirectory()) {
            copyDirectory(sourcePath, targetPath);
        } else if (entry.isFile()) {
            const next = readFileSync(sourcePath);
            const current = existsSync(targetPath)
                ? readFileSync(targetPath)
                : undefined;
            if (!current || !current.equals(next)) {
                writeFileSync(targetPath, next);
            }
        }
    }
}

function syncBuiltinAgentSkills() {
    if (!existsSync(bundledAgentSkillsDir)) {
        return { source: bundledAgentSkillsDir, target: activeAgentSkillsDir, synced: [] };
    }

    mkdirSync(activeAgentSkillsDir, { recursive: true });
    const synced = [];
    for (const entry of readdirSync(bundledAgentSkillsDir, { withFileTypes: true })) {
        if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
        const source = path.join(bundledAgentSkillsDir, entry.name);
        if (!existsSync(path.join(source, 'SKILL.md'))) continue;
        copyDirectory(source, path.join(activeAgentSkillsDir, entry.name));
        synced.push(entry.name);
    }
    return { source: bundledAgentSkillsDir, target: activeAgentSkillsDir, synced };
}

function displayPath(filePath) {
    const resolved = path.resolve(filePath);
    if (isWithin(resolved, appDir)) {
        return path.relative(appDir, resolved).split(path.sep).join('/');
    }
    if (isWithin(resolved, murphHome)) {
        return `~/.murph/${path.relative(murphHome, resolved).split(path.sep).join('/')}`;
    }
    return resolved;
}

function nearestHeading(lines, index) {
    for (let i = index; i >= 0; i -= 1) {
        const match = lines[i].match(/^#{1,6}\s+(.+)$/);
        if (match) return match[1].trim();
    }
    return undefined;
}

function excerptFor(lines, index) {
    const start = Math.max(0, index - 1);
    const end = Math.min(lines.length, index + 2);
    return lines
        .slice(start, end)
        .map((line) => line.trim())
        .filter(Boolean)
        .join(' ')
        .replace(/\s+/g, ' ')
        .slice(0, 500);
}

function scoreMatch({ filePath, heading, excerpt }, terms) {
    const haystack = normalizeText(`${path.basename(filePath)} ${heading || ''} ${excerpt}`);
    const sourceScore =
        isWithin(filePath, activeAgentSkillsDir) || isWithin(filePath, bundledAgentSkillsDir)
            ? 4
            : 0;
    return terms.reduce((score, term) => {
        if (normalizeText(path.basename(filePath)).includes(term)) score += 4;
        if (normalizeText(heading).includes(term)) score += 3;
        if (haystack.includes(term)) score += 1;
        return score;
    }, sourceScore);
}

function searchFiles({ query, roots, extensions, limit = 5 }) {
    const terms = queryTerms(query);
    if (terms.length === 0) {
        return { query, results: [], searched: [] };
    }

    const files = [...new Set(roots.flatMap((root) => filesUnder(root, extensions)))];
    const results = [];
    for (const filePath of files) {
        let text;
        try {
            text = readFileSync(filePath, 'utf8');
        } catch {
            continue;
        }
        const lines = text.split(/\r?\n/);
        for (let index = 0; index < lines.length; index += 1) {
            const line = normalizeText(lines[index]);
            if (!terms.some((term) => line.includes(term))) continue;
            const heading = nearestHeading(lines, index);
            const excerpt = excerptFor(lines, index);
            const score = scoreMatch({ filePath, heading, excerpt }, terms);
            if (score === 0) continue;
            results.push({
                path: displayPath(filePath),
                line: index + 1,
                heading,
                excerpt,
                score,
            });
        }
    }

    results.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path) || a.line - b.line);
    const seen = new Set();
    const deduped = [];
    for (const result of results) {
        const key = `${result.path}:${result.heading || ''}:${result.excerpt}`;
        if (seen.has(key)) continue;
        seen.add(key);
        deduped.push(result);
        if (deduped.length >= clampLimit(limit)) break;
    }

    return {
        query,
        results: deduped.map(({ score, ...result }) => result),
        searched: files.map((filePath) => displayPath(filePath)),
    };
}

function searchMurphDocs(query, limit) {
    return searchFiles({
        query,
        extensions: new Set(['.md']),
        limit,
        roots: [
            path.join(appDir, 'README.md'),
            path.join(appDir, 'docs', 'index.md'),
            path.join(appDir, 'docs', 'docs'),
            activeAgentSkillsDir,
            bundledAgentSkillsDir,
        ],
    });
}

function searchMurphArchitecture(query, limit) {
    return searchFiles({
        query,
        extensions: new Set(['.md', '.ts', '.tsx', '.js', '.mjs', '.json']),
        limit,
        roots: [
            activeAgentSkillsDir,
            bundledAgentSkillsDir,
            path.join(appDir, 'shared', 'cli'),
            path.join(appDir, 'shared', 'server'),
            path.join(appDir, 'app/team'),
            path.join(appDir, 'app/personal'),
            path.join(appDir, 'scripts'),
            path.join(appDir, 'policies'),
            path.join(murphHome, 'policies'),
            path.join(appDir, 'skills', 'runtime'),
            path.join(murphHome, 'skills'),
            path.join(appDir, 'docs', 'docs', 'core-concepts.md'),
            path.join(appDir, 'docs', 'docs', 'plugins.md'),
            path.join(appDir, 'docs', 'docs', 'channels.md'),
            path.join(appDir, 'docs', 'docs', 'policy.md'),
        ],
    });
}

async function confirmTool(toolName, args, ctx) {
    if (!ctx.hasUI) {
        return false;
    }
    return ctx.ui.confirm(`Allow ${toolName}?`, JSON.stringify(args, null, 2));
}

async function promptCredential(provider, ctx) {
    if (!ctx.hasUI) {
        throw new Error('credential_required');
    }
    const credential = await ctx.ui.input(
        `Credential for ${provider}`,
        'Stored locally by Murph; not included in the model transcript.',
    );
    return String(credential || '').trim();
}

function safePluginId(raw) {
    const id = String(raw || '')
        .trim()
        .toLowerCase();
    if (!/^[a-z0-9][a-z0-9._-]*$/.test(id)) {
        throw new Error(`Invalid plugin id: ${raw || '<empty>'}`);
    }
    return id;
}

function safeToolName(raw) {
    const name = String(raw || '').trim();
    if (!/^[a-z0-9][a-z0-9._-]*$/i.test(name)) {
        throw new Error(`Invalid tool name: ${raw || '<empty>'}`);
    }
    return name;
}

const RETRIEVAL_PROFILES = new Set([
    'generic',
    'title_keywords',
    'work_item',
    'code_review',
    'email_thread',
    'team_discussion',
]);

function safeRetrievalProfile(raw) {
    const profile = String(raw || 'generic').trim();
    if (!RETRIEVAL_PROFILES.has(profile)) {
        throw new Error(`Invalid retrieval profile: ${raw || '<empty>'}`);
    }
    return profile;
}

function ensureUnderRoot(root, candidate) {
    const rootPath = path.resolve(root);
    const resolved = path.resolve(candidate);
    if (
        resolved !== rootPath &&
        !resolved.startsWith(`${rootPath}${path.sep}`)
    ) {
        throw new Error(`Path escapes plugin root: ${candidate}`);
    }
    return resolved;
}

function scaffoldPlugin(params) {
    const id = safePluginId(params.id);
    const allowedCategories = new Set([
        'channels',
        'tools',
        'skills',
        'context',
        'bundles',
        'legacy',
    ]);
    const category =
        params.includeChannel === true
            ? 'channels'
            : allowedCategories.has(params.category)
              ? params.category
              : 'tools';
    const root =
        category === 'legacy'
            ? path.join(murphHome, 'plugins', id)
            : path.join(murphHome, 'plugins', category, id);
    if (existsSync(root)) {
        throw new Error(`Plugin already exists: ${root}`);
    }

    const includeChannel = category === 'channels' || params.includeChannel === true;
    const includeSkill = includeChannel
        ? params.includeSkill === true
        : category === 'skills'
          ? params.includeSkill !== false
          : params.includeSkill !== false;
    const includeIntegration = includeChannel
        ? params.includeIntegration === true
        : category === 'skills'
          ? params.includeIntegration === true
          : params.includeIntegration !== false;
    const includeSearchTool =
        includeIntegration && params.includeSearchTool !== false;
    const name = params.name || id;
    const description = params.description || `${name} plugin for Murph.`;
    const capabilities = { channels: [], skills: [], integrations: [] };

    mkdirSync(root, { recursive: true });

    if (includeChannel) {
        const channelPath = path.join(root, 'channel.mjs');
        writeFileSync(
            channelPath,
            `export const channel = {
  id: '${id}',
  displayName: '${name}',
  description: '${description}',
  runtime: {
    id: '${id}',
    displayName: '${name}',
    capabilities: ['event_ingress', 'thread_fetch', 'reply_post'],
    normalizeEvent(event, envelope) {
      // Convert provider webhook/realtime payloads into Murph ContinuityTask objects.
      return null;
    },
    async fetchThread(workspace, thread) {
      return [];
    },
    async postReply(workspace, thread, text) {
      throw new Error('Implement ${id} postReply');
    }
  },
  setup: {
    requirements: [],
    getStatus() {
      return { configured: false, installed: false };
    },
    async listMembers(workspace) {
      return [];
    },
    async getMember(workspace, userId) {
      return { id: userId, displayName: userId };
    },
    async listChannels(workspace) {
      return [];
    },
    async getChannel(workspace, channelId) {
      return { id: channelId, displayName: channelId };
    }
  },
  ingress: {
    async handleWebhook({ rawBody, headers, url }) {
      return { ok: false, error: 'Implement ${id} webhook handling' };
    }
  }
};
`,
        );
        capabilities.channels.push('channel.mjs');
    }

    if (includeSkill) {
        const skillDir = ensureUnderRoot(root, path.join(root, 'skills'));
        mkdirSync(skillDir, { recursive: true });
        const skillPath = path.join(skillDir, `${id}.md`);
        writeFileSync(
            skillPath,
            [
                '---',
                `name: ${id}`,
                `description: ${description}`,
                'knowledgeDomains: [integration]',
                'priority: 10',
                '---',
                `Use this skill when the user asks about ${name}.`,
                '',
                'Prefer grounded answers from integration context sources and tools before giving setup guidance.',
            ].join('\n'),
        );
        capabilities.skills.push(`skills/${id}.md`);
    }

    if (includeIntegration) {
        const integrationDir = ensureUnderRoot(
            root,
            path.join(root, 'integrations'),
        );
        mkdirSync(integrationDir, { recursive: true });
        const integrationPath = path.join(integrationDir, `${id}.mjs`);
        const envKey = `${id.toUpperCase().replace(/[^A-Z0-9]/g, '_')}_API_KEY`;
        const searchProfile = includeSearchTool
            ? safeRetrievalProfile(params.searchProfile)
            : 'generic';
        const searchToolName = includeSearchTool
            ? safeToolName(params.searchToolName || `${id}.search`)
            : `${id}.search`;
        const toolsSource = includeSearchTool
            ? `[
    {
      name: '${searchToolName}',
      description: 'Search ${name} by query text.',
      sideEffectClass: 'read',
      retrievalEligible: true,
      retrieval: { profile: '${searchProfile}' },
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['query'],
        properties: {
          query: { type: 'string' },
          limit: { type: 'number' }
        }
      },
      knowledgeDomains: ['integration'],
      optional: true,
      requiresWorkspaceEnablement: true,
      supportsDryRun: true,
      async execute(input) {
        return {
          results: [],
          query: input.query,
          hint: 'Implement ${searchToolName} in this integration. Keep the normalized { query, limit } contract.'
        };
      }
    }
  ]`
            : '[]';
        writeFileSync(
            integrationPath,
            `export default {
  id: '${id}',
  name: '${name}',
  description: '${description}',
  credential: {
    authType: 'api_key',
    credentialKind: 'api_key',
    envKey: '${envKey}',
    credentialLabel: 'API key'
  },
  tools: ${toolsSource},
  contextSources: [],
  isConfigured() {
    return Boolean(process.env.${envKey});
  }
};
`,
        );
        capabilities.integrations.push(`integrations/${id}.mjs`);
    }

    writeFileSync(
        path.join(root, 'plugin.json'),
        JSON.stringify(
            {
                id,
                name,
                description,
                version: '0.1.0',
                capabilities,
            },
            null,
            2,
        ),
    );

    return { root, manifest: path.join(root, 'plugin.json'), capabilities };
}

function validatePluginRoot(pluginRoot) {
    const root = path.resolve(pluginRoot);
    const manifestPath = path.join(root, 'plugin.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    const capabilities = manifest.capabilities || {};
    const paths = [
        ...(capabilities.channels || []),
        ...(capabilities.skills || []),
        ...(capabilities.integrations || []),
    ];

    if (!manifest.id || !/^[a-z0-9][a-z0-9._-]*$/i.test(manifest.id)) {
        throw new Error('plugin.json has an invalid id');
    }
    if (!manifest.name || !manifest.description) {
        throw new Error('plugin.json requires name and description');
    }
    if (paths.length === 0) {
        throw new Error(
            'plugin.json must declare at least one channel, skill, or integration',
        );
    }
    for (const relativePath of paths) {
        const target = ensureUnderRoot(root, path.join(root, relativePath));
        if (!existsSync(target)) {
            throw new Error(`Missing plugin file: ${relativePath}`);
        }
    }
    return { ok: true, root, id: manifest.id, capabilities };
}

function createMurphTools() {
    return [
        defineTool({
            name: 'murph_product_context',
            label: 'Murph product context',
            description:
                'Read the active Murph product context and Team/Personal capability boundary.',
            promptSnippet:
                'murph_product_context: inspect whether this agent is configuring Murph Team or Murph Personal before product-sensitive work.',
            parameters: Type.Object({}),
            execute: async () => textResult(await readProductContext()),
        }),
        defineTool({
            name: 'murph_setup_status',
            label: 'Murph setup status',
            description: 'Read Murph setup readiness from the running server.',
            promptSnippet: 'murph_setup_status: inspect Murph setup readiness.',
            parameters: Type.Object({}),
            execute: async () => requestJsonTool('GET', '/api/setup/status'),
        }),
        defineTool({
            name: 'murph_setup_doctor',
            label: 'Murph setup doctor',
            description: 'Read the detailed Murph setup doctor result.',
            promptSnippet:
                'murph_setup_doctor: inspect detailed setup diagnostics.',
            parameters: Type.Object({}),
            execute: async () => requestJsonTool('GET', '/api/setup/doctor'),
        }),
        defineTool({
            name: 'murph_runtime_health',
            label: 'Murph health',
            description: 'Read Murph server health.',
            promptSnippet:
                'murph_runtime_health: check whether the Murph server is responding.',
            parameters: Type.Object({}),
            execute: async () => requestJsonTool('GET', '/api/health'),
        }),
        defineTool({
            name: 'murph_docs_search',
            label: 'Search Murph docs',
            description:
                'Search local Murph docs and Murph Agent built-in skills.',
            promptSnippet:
                'murph_docs_search: search Murph docs and built-in skills before answering user-facing Murph questions.',
            parameters: Type.Object({
                query: Type.String(),
                limit: Type.Optional(Type.Number()),
            }),
            execute: async (_toolCallId, params) =>
                textResult(searchMurphDocs(params.query, params.limit)),
        }),
        defineTool({
            name: 'murph_architecture_search',
            label: 'Search Murph architecture',
            description:
                'Search current Murph source and docs for runtime, plugin, channel, policy, and config questions.',
            promptSnippet:
                'murph_architecture_search: search current Murph source and docs before answering core runtime or extension questions.',
            parameters: Type.Object({
                query: Type.String(),
                limit: Type.Optional(Type.Number()),
            }),
            execute: async (_toolCallId, params) =>
                textResult(searchMurphArchitecture(params.query, params.limit)),
        }),
        defineTool({
            name: 'murph_integration_status',
            label: 'Murph integration status',
            description: 'Read Murph integration status.',
            promptSnippet:
                'murph_integration_status: inspect configured integrations.',
            parameters: Type.Object({}),
            execute: async () =>
                requestJsonTool('GET', '/api/integrations/status'),
        }),
        defineTool({
            name: 'murph_integration_connect',
            label: 'Connect Murph integration',
            description:
                'Prompt locally for a credential and connect a Murph integration.',
            promptSnippet:
                'murph_integration_connect: connect an integration using a local credential prompt.',
            parameters: Type.Object({
                provider: Type.String({
                    description:
                        'Provider id, such as github, notion, or granola.',
                }),
            }),
            executionMode: 'sequential',
            execute: async (_toolCallId, params, _signal, _onUpdate, ctx) => {
                const credential = await promptCredential(params.provider, ctx);
                if (!credential) {
                    throw new Error('credential_required');
                }
                return requestJsonTool(
                    'POST',
                    `/api/integrations/${encodeURIComponent(params.provider)}/connect`,
                    { credential },
                );
            },
        }),
        defineTool({
            name: 'murph_plugin_status',
            label: 'Murph plugin status',
            description: 'Read scoped Murph plugin load status.',
            promptSnippet:
                'murph_plugin_status: inspect scoped plugin load status.',
            parameters: Type.Object({}),
            execute: async () => requestJsonTool('GET', '/api/plugins/status'),
        }),
        defineTool({
            name: 'murph_plugin_create_draft',
            label: 'Create Murph plugin draft',
            description:
                'Create a scoped Murph plugin draft under ~/.murph/plugins/<category>.',
            promptSnippet:
                'murph_plugin_create_draft: create a scoped channel, skill, or integration plugin package.',
            parameters: Type.Object({
                id: Type.String(),
                name: Type.Optional(Type.String()),
                description: Type.Optional(Type.String()),
                category: Type.Optional(Type.Union([
                    Type.Literal('channels'),
                    Type.Literal('tools'),
                    Type.Literal('skills'),
                    Type.Literal('context'),
                    Type.Literal('bundles'),
                    Type.Literal('legacy'),
                ])),
                includeChannel: Type.Optional(Type.Boolean()),
                includeSkill: Type.Optional(Type.Boolean()),
                includeIntegration: Type.Optional(Type.Boolean()),
                includeSearchTool: Type.Optional(Type.Boolean()),
                searchProfile: Type.Optional(Type.Union([
                    Type.Literal('generic'),
                    Type.Literal('title_keywords'),
                    Type.Literal('work_item'),
                    Type.Literal('code_review'),
                    Type.Literal('email_thread'),
                    Type.Literal('team_discussion'),
                ])),
                searchToolName: Type.Optional(Type.String()),
            }),
            executionMode: 'sequential',
            execute: async (_toolCallId, params) =>
                textResult(scaffoldPlugin(params)),
        }),
        defineTool({
            name: 'murph_plugin_validate',
            label: 'Validate Murph plugin',
            description:
                'Run local manifest and path validation for a scoped plugin package.',
            promptSnippet:
                'murph_plugin_validate: validate a scoped plugin package.',
            parameters: Type.Object({
                root: Type.String({
                    description:
                        'Absolute plugin root, or a plugin id/path under ~/.murph/plugins.',
                }),
            }),
            execute: async (_toolCallId, params) => {
                const root = path.isAbsolute(params.root)
                    ? params.root
                    : path.join(murphHome, 'plugins', params.root);
                return textResult(validatePluginRoot(root));
            },
        }),
        defineTool({
            name: 'murph_plugin_install',
            label: 'Install Murph plugin',
            description:
                'Validate a scoped Murph plugin package and reload plugins in the running server.',
            promptSnippet:
                'murph_plugin_install: validate and reload scoped plugins.',
            parameters: Type.Object({
                root: Type.String({
                    description:
                        'Absolute plugin root, or a plugin id/path under ~/.murph/plugins.',
                }),
            }),
            executionMode: 'sequential',
            execute: async (_toolCallId, params) => {
                try {
                    const root = path.isAbsolute(params.root)
                        ? params.root
                        : path.join(murphHome, 'plugins', params.root);
                    const validation = validatePluginRoot(root);
                    const reload = await requestJson(
                        'POST',
                        '/api/plugins/reload',
                    );
                    return textResult({ validation, reload });
                } catch (error) {
                    return textResult({
                        ok: false,
                        error:
                            error instanceof Error
                                ? error.message
                                : String(error),
                        hint: `Validate the plugin path and make sure Murph is running at ${murphUrl}.`,
                    });
                }
            },
        }),
        defineTool({
            name: 'murph_plugin_reload',
            label: 'Reload Murph plugins',
            description: 'Reload scoped Murph plugins in the running server.',
            promptSnippet:
                'murph_plugin_reload: reload scoped plugin packages.',
            parameters: Type.Object({}),
            executionMode: 'sequential',
            execute: async () => requestJsonTool('POST', '/api/plugins/reload'),
        }),
        defineTool({
            name: 'murph_policy_profiles',
            label: 'Murph policy profiles',
            description: 'List available Murph policy profiles.',
            promptSnippet:
                'murph_policy_profiles: list available policy profiles.',
            parameters: Type.Object({}),
            execute: async () =>
                requestJsonTool('GET', '/api/gateway/policy-profiles'),
        }),
        defineTool({
            name: 'murph_policy_get',
            label: 'Murph policy config',
            description: 'Read Murph local policy configuration.',
            promptSnippet:
                'murph_policy_get: inspect selected policy profile/config.',
            parameters: Type.Object({}),
            execute: async () =>
                requestJsonTool('GET', '/api/gateway/policy/config'),
        }),
        defineTool({
            name: 'murph_policy_preview',
            label: 'Preview Murph policy',
            description:
                'Preview an effective Murph policy profile and optional override.',
            promptSnippet:
                'murph_policy_preview: preview policy changes before saving.',
            parameters: Type.Object({
                profileName: Type.Optional(Type.String()),
                overrideRaw: Type.Optional(Type.String()),
                sessionMode: Type.Optional(Type.String()),
            }),
            execute: async (_toolCallId, params) =>
                requestJsonTool('POST', '/api/gateway/policy/preview', params),
        }),
        defineTool({
            name: 'murph_policy_set',
            label: 'Set Murph policy',
            description: 'Set the Murph local policy profile.',
            promptSnippet:
                'murph_policy_set: save the selected policy profile.',
            parameters: Type.Object({
                profileName: Type.String(),
            }),
            executionMode: 'sequential',
            execute: async (_toolCallId, params) =>
                requestJsonTool('PUT', '/api/gateway/policy/config', params),
        }),
    ];
}

function murphSystemPrompt(sourceEdits) {
    return [
        'You are Murph Agent, a user-facing coding agent embedded in the Murph CLI.',
        'Your job is to help the local operator set up Murph, debug Murph, build scoped integrations, create skills/connectors, and adjust policy configuration.',
        runtimeContextPrompt(),
        'If a request is valid only for the other Murph product, say it is unsupported in the active runtime and suggest the matching Team or Personal deployment.',
        'Do not perform Team admin work in Murph Personal. Do not claim Personal local privacy or private-machine data guarantees in Murph Team.',
        'Use murph_product_context when the active product or product capability boundary is relevant or unclear.',
        'Murph async messenger runtime is separate. Do not present yourself as the async runtime brain.',
        'Built-in Murph Agent skills are Pi skills for this local setup/coding agent. They are separate from Murph runtime skills used by the async messenger runtime.',
        'Use relevant Murph Agent skills for workflow guidance. Use murph_docs_search for user-facing docs questions and murph_architecture_search for runtime, plugin, channel, policy, and config architecture questions before falling back to generic grep.',
        'Prefer Murph custom tools for setup, integration status, plugin reload, and policy changes before editing files by hand.',
        'For custom policy changes, inspect the current policy with murph_policy_get/profiles, edit or create ~/.murph/policies/*.md, preview changes with murph_policy_preview, then select the profile with murph_policy_set.',
        'For new capabilities, prefer category-scoped plugin packages under ~/.murph/plugins/{channels,tools,skills,context,bundles}/<id>.',
        'For custom messaging providers, create channel plugins under ~/.murph/plugins/channels/<id>; do not edit Murph core runtime files.',
        'When creating a searchable connector, implement it as an integrations/*.mjs module and include a read-only { query, limit } search tool with retrievalEligible: true and retrieval.profile set to the closest preset.',
        'Installed connector tools must remain read-only. Channel plugins may post through their channel runtime but should keep unrelated tools read-only.',
        sourceEdits
            ? 'This run explicitly allows Murph source edits. Keep changes focused and validate them.'
            : 'Default write scope is Plugin+Config. Do not modify Murph source files unless the operator restarts with --source-edits or explicitly asks for source edits.',
        'Never ask the user to paste credentials into chat. Use credential tools that prompt locally.',
    ].join('\n');
}

function builtinSkillArgs() {
    return existsSync(activeAgentSkillsDir) ? ['--skill', activeAgentSkillsDir] : [];
}

function formatDuration(ms) {
    if (ms === undefined || ms === null) return 'n/a';
    if (ms < 1000) return `${Math.round(ms)}ms`;
    return `${(ms / 1000).toFixed(ms < 10000 ? 1 : 0)}s`;
}

function formatStatusValue(value) {
    if (value.status === 'fulfilled') {
        const payload = value.value;
        if (payload?.ok === false) return `error: ${payload.error || 'not ok'}`;
        if (payload?.status) return String(payload.status);
        return 'ok';
    }
    return `error: ${value.reason instanceof Error ? value.reason.message : String(value.reason)}`;
}

async function readMurphStatusSummary() {
    const [health, setup, integrations, plugins, policy] =
        await Promise.allSettled([
            requestJson('GET', '/api/health'),
            requestJson('GET', '/api/setup/status'),
            requestJson('GET', '/api/integrations/status'),
            requestJson('GET', '/api/plugins/status'),
            requestJson('GET', '/api/gateway/policy/config'),
        ]);
    return [
        `health: ${formatStatusValue(health)}`,
        `setup: ${formatStatusValue(setup)}`,
        `integrations: ${formatStatusValue(integrations)}`,
        `plugins: ${formatStatusValue(plugins)}`,
        `policy: ${formatStatusValue(policy)}`,
    ];
}

function createMurphExtension(initialState) {
    const state = {
        sourceEdits: Boolean(initialState.sourceEdits),
        lastLatency: undefined,
        current: undefined,
    };

    function setStatus(ctx, text, tone = 'dim') {
        if (!ctx.hasUI) return;
        const theme = ctx.ui.theme;
        const prefix =
            tone === 'accent'
                ? theme.fg('accent', 'murph')
                : theme.fg('dim', 'murph');
        ctx.ui.setStatus('murph', `${prefix} ${theme.fg(tone, text)}`);
    }

    function finishLatency() {
        const current = state.current;
        if (!current) return;
        const totalMs = Date.now() - current.startedAt;
        state.lastLatency = {
            providerMs: current.providerMs,
            firstTokenMs: current.firstTokenAt
                ? current.firstTokenAt - current.startedAt
                : undefined,
            toolMs: current.toolMs,
            toolCount: current.toolCount,
            totalMs,
        };
        state.current = undefined;
    }

    return (pi) => {
        for (const tool of createMurphTools()) {
            pi.registerTool(tool);
        }

        pi.on('session_start', async (_event, ctx) => {
            ctx.ui.setTheme('murph-agent');
            ctx.ui.setWorkingVisible(true);
            ctx.ui.setWorkingIndicator({
                frames: ['-', '\\', '|', '/'],
                intervalMs: 90,
            });
            ctx.ui.setWorkingMessage('working through the request');
            ctx.ui.setTitle(`murph agent - ${path.basename(appDir)}`);
            ctx.ui.setStatus(
                'murph-scope',
                state.sourceEdits
                    ? ctx.ui.theme.fg('warning', 'source edits')
                    : ctx.ui.theme.fg('success', 'plugin+config'),
            );
            setStatus(ctx, 'idle');
        });

        pi.on('before_agent_start', async (_event, ctx) => {
            state.current = {
                startedAt: Date.now(),
                providerStartedAt: undefined,
                providerMs: undefined,
                firstTokenAt: undefined,
                toolMs: 0,
                toolCount: 0,
                activeTools: new Map(),
            };
            ctx.ui.setWorkingMessage('checking context and deciding next step');
            setStatus(ctx, 'thinking', 'accent');
        });

        pi.on('before_provider_request', async (_event, ctx) => {
            if (
                state.current &&
                state.current.providerStartedAt === undefined
            ) {
                state.current.providerStartedAt = Date.now();
            }
            ctx.ui.setWorkingMessage('waiting on model');
            setStatus(ctx, 'calling model', 'accent');
        });

        pi.on('after_provider_response', async (_event, ctx) => {
            if (
                state.current?.providerStartedAt &&
                state.current.providerMs === undefined
            ) {
                state.current.providerMs =
                    Date.now() - state.current.providerStartedAt;
            }
            ctx.ui.setWorkingMessage('streaming response');
            setStatus(ctx, 'streaming', 'accent');
        });

        pi.on('message_update', async (event, ctx) => {
            if (event.assistantMessageEvent?.type !== 'text_delta') return;
            if (state.current && state.current.firstTokenAt === undefined) {
                state.current.firstTokenAt = Date.now();
            }
            setStatus(ctx, 'streaming', 'accent');
        });

        pi.on('tool_execution_start', async (event, ctx) => {
            if (state.current) {
                state.current.toolCount += 1;
                state.current.activeTools.set(event.toolCallId, Date.now());
            }
            ctx.ui.setWorkingMessage(`running ${event.toolName}`);
            setStatus(ctx, `running ${event.toolName}`, 'accent');
        });

        pi.on('tool_execution_end', async (event, ctx) => {
            const startedAt = state.current?.activeTools.get(event.toolCallId);
            if (state.current && startedAt) {
                state.current.toolMs += Date.now() - startedAt;
                state.current.activeTools.delete(event.toolCallId);
            }
            if (event.isError) {
                setStatus(ctx, `${event.toolName} failed`, 'error');
            }
        });

        pi.on('agent_end', async (_event, ctx) => {
            finishLatency();
            const suffix = state.lastLatency
                ? `last turn ${formatDuration(state.lastLatency.totalMs)}`
                : 'idle';
            ctx.ui.setWorkingMessage();
            setStatus(ctx, suffix);
        });

        pi.on('tool_call', async (event, ctx) => {
            if (event.toolName === 'write' || event.toolName === 'edit') {
                const target = resolvePathForTool(event.input.path);
                if (
                    !state.sourceEdits &&
                    !isAllowedPluginOrConfigPath(target)
                ) {
                    return {
                        block: true,
                        reason: `Direct source edits are disabled for this run. Use --source-edits to modify ${target}.`,
                    };
                }
            }

            if (event.toolName === 'bash') {
                const command = String(event.input.command || '');
                if (bashLooksHardBlocked(command)) {
                    return {
                        block: true,
                        reason: 'Command is blocked by Murph agent safety policy.',
                    };
                }
                if (!state.sourceEdits && bashLooksSourceMutating(command)) {
                    return {
                        block: true,
                        reason: 'This command appears to mutate source or dependencies. Use --source-edits for this run if that is intended.',
                    };
                }
                if (state.sourceEdits && bashNeedsApproval(command)) {
                    const approved = await confirmTool(
                        event.toolName,
                        event.input,
                        ctx,
                    );
                    return approved
                        ? undefined
                        : {
                              block: true,
                              reason: 'User declined tool execution.',
                          };
                }
                return undefined;
            }

            if (!MUTATING_TOOLS.has(event.toolName)) {
                return undefined;
            }

            const approved = await confirmTool(
                event.toolName,
                event.input,
                ctx,
            );
            return approved
                ? undefined
                : { block: true, reason: 'User declined tool execution.' };
        });

        pi.registerCommand('murph-status', {
            description:
                'Show Murph server, setup, integration, plugin, and policy status.',
            handler: async (_args, ctx) => {
                try {
                    ctx.ui.notify(
                        (await readMurphStatusSummary()).join('\n'),
                        'info',
                    );
                } catch (error) {
                    ctx.ui.notify(
                        error instanceof Error ? error.message : String(error),
                        'error',
                    );
                }
            },
        });

        pi.registerCommand('latency', {
            description: 'Show the last Murph Agent turn latency breakdown.',
            handler: async (_args, ctx) => {
                if (!state.lastLatency) {
                    ctx.ui.notify('No completed turn yet.', 'info');
                    return;
                }
                ctx.ui.notify(
                    [
                        `model wait: ${formatDuration(state.lastLatency.providerMs)}`,
                        `first token: ${formatDuration(state.lastLatency.firstTokenMs)}`,
                        `tools: ${state.lastLatency.toolCount} calls / ${formatDuration(state.lastLatency.toolMs)}`,
                        `total: ${formatDuration(state.lastLatency.totalMs)}`,
                    ].join('\n'),
                    'info',
                );
            },
        });

        pi.registerCommand('source-edits', {
            description:
                'Toggle direct Murph source edits for this session: /source-edits on|off.',
            handler: async (args, ctx) => {
                const value = args.trim().toLowerCase();
                if (value !== 'on' && value !== 'off') {
                    ctx.ui.notify('Usage: /source-edits on|off', 'warning');
                    return;
                }
                state.sourceEdits = value === 'on';
                ctx.ui.setStatus(
                    'murph-scope',
                    state.sourceEdits
                        ? ctx.ui.theme.fg('warning', 'source edits')
                        : ctx.ui.theme.fg('success', 'plugin+config'),
                );
                ctx.ui.notify(
                    state.sourceEdits
                        ? 'Source edits enabled.'
                        : 'Plugin+Config write scope restored.',
                    'info',
                );
            },
        });

        pi.registerCommand('tool-log', {
            description: 'Alias for expanded tool cards: /tool-log on|off.',
            handler: async (args, ctx) => {
                const value = args.trim().toLowerCase();
                if (value !== 'on' && value !== 'off') {
                    ctx.ui.notify('Usage: /tool-log on|off', 'warning');
                    return;
                }
                ctx.ui.setToolsExpanded(value === 'on');
                ctx.ui.notify(
                    value === 'on'
                        ? 'Tool details expanded.'
                        : 'Tool details collapsed.',
                    'info',
                );
            },
        });
    };
}

function buildPiArgs(prompt, options, passthrough) {
    const provider = options.provider || defaultProvider();
    const modelId = options.model || defaultModel(provider);
    const apiKey = apiKeyFor(provider);
    if (!apiKey) {
        throw new Error(
            `Missing API key for ${provider}. Run murph setup provider to choose model defaults or set the provider API key in ~/.murph/.credentials.`,
        );
    }

    const piArgs = [
        '--provider',
        provider,
        '--model',
        modelId,
        '--api-key',
        apiKey,
        '--append-system-prompt',
        murphSystemPrompt(Boolean(options.sourceEdits)),
        '--theme',
        path.join(appDir, 'themes/murph-agent.json'),
        '--tools',
        DEFAULT_TOOL_NAMES.join(','),
        ...builtinSkillArgs(),
        '--thinking',
        options.thinking || (options.sourceEdits ? 'medium' : 'low'),
        ...passthrough,
    ];

    if (!options.noSession) {
        piArgs.push('--session-dir', sessionDirForCwd(appDir));
    } else {
        piArgs.push('--no-session');
    }
    if (options.continueSession) {
        piArgs.push('--continue');
    }
    if (options.verboseTools || process.env.MURPH_AGENT_VERBOSE_TOOLS) {
        piArgs.push('--verbose');
    }
    if (options.print) {
        piArgs.push('--print');
    }
    if (prompt) {
        piArgs.push(prompt);
    }

    return piArgs;
}

async function runAgent(prompt, options, passthrough) {
    if (options.unsupportedOption) {
        throw new Error(
            `${options.unsupportedOption} is no longer supported. Run murph agent so Murph can start the local server for setup, integration, plugin, and policy tools.`,
        );
    }

    if (options.version) {
        await runPiMain(['--version']);
        return;
    }

    mkdirSync(agentDir, { recursive: true });
    process.env.PI_CODING_AGENT_DIR = agentDir;
    syncBuiltinAgentSkills();

    const piArgs = buildPiArgs(prompt, options, passthrough);
    await runPiMain(piArgs, {
        extensionFactories: [
            createMurphExtension({ sourceEdits: options.sourceEdits }),
        ],
    });
}

export {
    DEFAULT_TOOL_NAMES,
    buildPiArgs,
    scaffoldPlugin,
    searchMurphArchitecture,
    searchMurphDocs,
    syncBuiltinAgentSkills,
};

const isDirectRun =
    process.argv[1] &&
    import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun) {
    const { options, prompt, passthrough } = parseArgs(process.argv.slice(2));
    if (options.help) {
        usage();
        process.exit(0);
    }

    runAgent(prompt, options, passthrough).catch((error) => {
        printBox(
            'agent failed',
            [error instanceof Error ? error.message : String(error)],
            'red',
        );
        process.exitCode = 1;
    });
}
