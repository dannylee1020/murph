#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import path from 'node:path';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { parse, stringify } from 'yaml';

const appDir = process.env.MURPH_APP_DIR || process.cwd();
const murphUrl = process.env.MURPH_URL || `http://localhost:${process.env.MURPH_PORT || '5173'}`;
const murphHome = process.env.MURPH_HOME || path.join(homedir(), '.murph');
const credentialsPath = process.env.MURPH_CREDENTIALS_PATH || path.join(murphHome, '.credentials');
const configPath = process.env.MURPH_CONFIG_PATH || path.join(murphHome, 'config.yaml');
const slackManifestPath = path.join(appDir, 'docs', 'public', 'slack-manifest.yaml');
const slackApiBase = process.env.MURPH_SLACK_API_BASE || 'https://slack.com/api';
const discordApiBase = process.env.MURPH_DISCORD_API_BASE || 'https://discord.com/api/v10';
const discordBotPermissions = '274877991936';
const discordLimitedIntentFlags = {
  guildMembers: 1 << 15,
  messageContent: 1 << 19
};
const discordRequiredLimitedIntentFlags = discordLimitedIntentFlags.guildMembers | discordLimitedIntentFlags.messageContent;
const discordPermissionLabels = [
  'View Channels',
  'Send Messages',
  'Embed Links',
  'Read Message History',
  'Send Messages in Threads'
];
const rl = readline.createInterface({ input, output });

const args = process.argv.slice(2);
const options = {
  quick: args.includes('--quick'),
  nonInteractive: args.includes('--non-interactive'),
  json: args.includes('--json'),
  reconnectSearch: args.includes('--reconnect-search')
};
const section = args.find((arg) => !arg.startsWith('--')) || 'all';
const colorEnabled = !process.env.NO_COLOR && (process.stdout.isTTY || Boolean(process.env.FORCE_COLOR));
const trueColorEnabled = colorEnabled && (
  process.env.COLORTERM === 'truecolor' ||
  process.env.COLORTERM === '24bit' ||
  Boolean(process.env.FORCE_COLOR)
);
const rgb = (r, g, b) => trueColorEnabled ? `\x1b[38;2;${r};${g};${b}m` : '';
const color = {
  reset: colorEnabled ? '\x1b[0m' : '',
  bold: colorEnabled ? '\x1b[1m' : '',
  dim: colorEnabled ? '\x1b[2m' : '',
  primary: trueColorEnabled ? rgb(255, 139, 61) : colorEnabled ? '\x1b[33m' : '',
  secondary: trueColorEnabled ? rgb(68, 146, 255) : colorEnabled ? '\x1b[36m' : '',
  accent: trueColorEnabled ? rgb(168, 122, 255) : colorEnabled ? '\x1b[35m' : '',
  success: trueColorEnabled ? rgb(74, 222, 128) : colorEnabled ? '\x1b[32m' : '',
  warning: trueColorEnabled ? rgb(251, 146, 60) : colorEnabled ? '\x1b[33m' : '',
  error: trueColorEnabled ? rgb(248, 113, 113) : colorEnabled ? '\x1b[31m' : '',
  info: trueColorEnabled ? rgb(34, 211, 238) : colorEnabled ? '\x1b[36m' : '',
  muted: trueColorEnabled ? rgb(148, 163, 184) : colorEnabled ? '\x1b[2m' : '',
  border: trueColorEnabled ? rgb(82, 82, 91) : colorEnabled ? '\x1b[2m' : '',
  green: colorEnabled ? '\x1b[32m' : '',
  yellow: colorEnabled ? '\x1b[33m' : '',
  cyan: colorEnabled ? '\x1b[36m' : '',
  red: colorEnabled ? '\x1b[31m' : ''
};
const SECTION_PURPOSES = {
  Core: 'Create local config defaults and the data directory.',
  'AI provider': 'Choose the runtime model and API key.',
  'Murph Agent model': 'Choose whether the local setup agent inherits runtime defaults.',
  'Channel provider': 'Choose the channel Murph should connect first.',
  Slack: 'Create the Slack app config and connect the workspace.',
  Discord: 'Connect a Discord bot to a server.',
  Identity: 'Confirm the user Murph should watch for.',
  Channels: 'Choose the default channel scope.',
  Schedule: 'Save the default workday schedule.',
  Policy: 'Choose the local policy profile.',
  'Setup status': 'Review local files, credentials, and setup readiness.'
};
const DEFAULT_PROVIDER_MODEL = {
  openai: 'gpt-5.5',
  anthropic: 'claude-opus-4-7'
};
const DEFAULT_AGENT_MODEL = DEFAULT_PROVIDER_MODEL;
const CONFIG_KEY_SETTERS = {
  MURPH_APP_URL: (config, value) => setPath(config, ['app', 'url'], value),
  MURPH_SQLITE_PATH: (config, value) => setPath(config, ['app', 'sqlitePath'], value),
  MURPH_DEFAULT_PROVIDER: (config, value) => setPath(config, ['ai', 'defaultProvider'], normalizeProvider(value)),
  MURPH_DEFAULT_MODEL: (config, value) => setPath(config, ['ai', 'defaultModel'], value),
  MURPH_AGENT_PROVIDER: (config, value) => setPath(config, ['ai', 'agent', 'provider'], normalizeProvider(value)),
  MURPH_AGENT_MODEL: (config, value) => setPath(config, ['ai', 'agent', 'model'], value),
  SLACK_EVENTS_MODE: (config, value) => setPath(config, ['channels', 'slack', 'eventsMode'], value === 'http' ? 'http' : 'socket'),
  SLACK_CLIENT_ID: (config, value) => setPath(config, ['channels', 'slack', 'clientId'], value),
  SLACK_APP_ID: (config, value) => setPath(config, ['channels', 'slack', 'appId'], value),
  SLACK_TEAM_ID: (config, value) => setPath(config, ['channels', 'slack', 'teamId'], value),
  SLACK_TEAM_NAME: (config, value) => setPath(config, ['channels', 'slack', 'teamName'], value),
  DISCORD_CLIENT_ID: (config, value) => setPath(config, ['channels', 'discord', 'clientId'], value),
  DISCORD_REDIRECT_URI: (config, value) => setPath(config, ['channels', 'discord', 'redirectUri'], value)
};
const CONFIG_KEYS = new Set(Object.keys(CONFIG_KEY_SETTERS));
const CONFIG_KEY_CLEARERS = {
  MURPH_AGENT_PROVIDER: (config) => deletePath(config, ['ai', 'agent', 'provider']),
  MURPH_AGENT_MODEL: (config) => deletePath(config, ['ai', 'agent', 'model'])
};
const SECRET_KEY_MAP = {
  OPENAI_API_KEY: ['openai', 'api_key'],
  ANTHROPIC_API_KEY: ['anthropic', 'api_key'],
  SLACK_APP_TOKEN: ['slack', 'app_token'],
  SLACK_CLIENT_SECRET: ['slack', 'client_secret'],
  SLACK_SIGNING_SECRET: ['slack', 'signing_secret'],
  DISCORD_BOT_TOKEN: ['discord', 'bot_token'],
  DISCORD_CLIENT_SECRET: ['discord', 'client_secret'],
  GOOGLE_ACCESS_TOKEN: ['google', 'access_token'],
  GOOGLE_CLIENT_SECRET: ['google', 'client_secret'],
  GITHUB_PAT: ['github', 'api_key'],
  NOTION_API_KEY: ['notion', 'api_key'],
  GRANOLA_API_KEY: ['granola', 'api_key'],
  TAVILY_API_KEY: ['tavily', 'api_key'],
  BRAVE_SEARCH_API_KEY: ['brave_search', 'api_key']
};

let selectedChannelProvider = null;
let selectedWorkspaceId = null;

function paint(style, text) {
  return `${color[style] || ''}${text}${color.reset}`;
}

function line(label, message, tone = 'info') {
  console.log(`${paint(tone, label.padEnd(6))} ${message}`);
}

function muted(text) {
  return paint('muted', text);
}

function callout(label, value) {
  console.log(`  ${paint('border', '|')} ${paint('bold', label)}`);
  console.log(`  ${paint('border', '|')} ${paint('primary', value)}`);
}

function usage() {
  console.log(`Usage: murph setup [section] [options]

Sections:
  core        Create core local config values and data directory.
  provider    Configure the runtime AI provider, then Murph Agent.
  ai          Alias for provider.
  slack       Configure Slack app credentials and OAuth install.
  discord     Configure Discord bot credentials and server install.
  identity    Pick the user Murph watches for.
  channels    Pick watched channels or all accessible channels.
  schedule    Save the default workday schedule.
  policy      Select the local policy profile.
  status      Show setup readiness.

Options:
  --quick            Skip sections that are already configured.
  --reconnect-search Re-run Slack OAuth to refresh user-search consent.
  --non-interactive  Do not prompt; report missing setup and exit nonzero.
  --json             JSON output for status.
`);
}

function sectionTitle(title) {
  if (!options.json) {
    console.log('');
    console.log(`${paint('primary', '==')} ${paint('bold', title)}`);
    const purpose = SECTION_PURPOSES[title];
    if (purpose) console.log(`   ${muted(purpose)}`);
  }
}

function fail(message) {
  throw new Error(message);
}

function info(message) {
  line('info', message, 'info');
}

function success(message) {
  line('ok', message, 'success');
}

function warn(message) {
  line('warn', message, 'warning');
}

function haveCommand(command) {
  return spawnSync('sh', ['-lc', `command -v ${command}`], { stdio: 'ignore' }).status === 0;
}

async function ask(question, defaultValue = '') {
  if (options.nonInteractive) {
    return defaultValue;
  }
  const suffix = defaultValue ? ` [${defaultValue}]` : '';
  const answer = await rl.question(`${paint('accent', '?')} ${paint('bold', question)}${muted(suffix)}: `);
  return answer.trim() || defaultValue;
}

async function askSecret(question, defaultValue = '') {
  return ask(defaultValue ? `${question} (leave blank to keep current)` : question, defaultValue);
}

async function askRequired(question, defaultValue = '') {
  while (true) {
    const answer = await ask(question, defaultValue);
    if (answer.trim()) return answer.trim();
    if (options.nonInteractive) fail(`Missing required value: ${question}`);
    warn('A value is required.');
  }
}

async function askChoice(question, choices, defaultValue = '') {
  const normalized = choices.map((choice) => choice.toLowerCase());
  while (true) {
    const answer = (await ask(question, defaultValue)).toLowerCase();
    if (normalized.includes(answer)) return choices[normalized.indexOf(answer)];
    if (options.nonInteractive) fail(`Invalid value for ${question}: ${answer}`);
    warn(`Choose one of: ${choices.join(', ')}.`);
  }
}

async function askIndex(question, items, defaultIndex = 1) {
  while (true) {
    const answer = await ask(question, String(defaultIndex));
    const index = Number.parseInt(answer, 10);
    if (Number.isInteger(index) && index >= 1 && index <= items.length) {
      return index - 1;
    }
    if (options.nonInteractive) fail(`Invalid selection for ${question}: ${answer}`);
    warn(`Enter a number from 1 to ${items.length}.`);
  }
}

async function askHour(question, defaultHour) {
  while (true) {
    const answer = await ask(question, String(defaultHour));
    const hour = Number.parseInt(answer, 10);
    if (Number.isInteger(hour) && hour >= 0 && hour <= 23) {
      return hour;
    }
    if (options.nonInteractive) fail(`Invalid hour for ${question}: ${answer}`);
    warn('Enter an hour from 0 to 23.');
  }
}

async function askChannelSelection(defaultAnswer, channels) {
  while (true) {
    const answer = await ask('Selection', defaultAnswer);
    if (answer.toLowerCase() === 'all') {
      return { mode: 'all_accessible', channels: [] };
    }

    const indexes = answer
      .split(',')
      .map((entry) => Number.parseInt(entry.trim(), 10));
    const invalid = indexes.some((index) => !Number.isInteger(index) || index < 1 || index > channels.length);
    if (!invalid && indexes.length > 0) {
      const selected = [...new Set(indexes)]
        .map((index) => channels[index - 1])
        .filter(Boolean)
        .map((channel) => ({ id: channel.id, displayName: channel.displayName }));
      if (selected.length > 0) {
        return { mode: 'selected', channels: selected };
      }
    }
    if (options.nonInteractive) fail(`Invalid channel selection: ${answer}`);
    warn(`Enter "all" or comma-separated numbers from 1 to ${channels.length}.`);
  }
}

function banner() {
  if (options.json) return;
  console.log(paint('border', '========================================'));
  console.log(`${paint('primary', 'Murph')} ${paint('bold', 'setup')} ${muted('CLI-first configuration')}`);
  console.log(`${muted('config')} ${configPath}`);
  console.log(`${muted('home  ')} ${murphHome}`);
  console.log(paint('border', '========================================'));
}

function statusLine(label, state, detail = '') {
  const tone = state === 'ok' ? 'success' : state === 'warning' ? 'warning' : 'error';
  const marker = state === 'ok' ? 'ok' : state === 'warning' ? 'warn' : 'miss';
  console.log(`${paint(tone, marker.padEnd(6))} ${label.padEnd(22)} ${detail}`);
}

function statusGroup(title) {
  if (!options.json) console.log(`\n${paint('accent', title)}`);
}

function readConfigFile() {
  if (!existsSync(configPath)) return {};
  const parsed = parse(readFileSync(configPath, 'utf8')) ?? {};
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    fail(`${configPath} must contain a YAML object.`);
  }
  return parsed;
}

function readCredentialsFile() {
  if (!existsSync(credentialsPath)) return { version: 1, credentials: [] };
  try {
    const parsed = JSON.parse(readFileSync(credentialsPath, 'utf8'));
    return {
      version: 1,
      credentials: Array.isArray(parsed?.credentials) ? parsed.credentials : []
    };
  } catch {
    return { version: 1, credentials: [] };
  }
}

function writeCredentialsFile(file) {
  mkdirSync(path.dirname(credentialsPath), { recursive: true, mode: 0o700 });
  writeFileSync(credentialsPath, `${JSON.stringify(file, null, 2)}\n`, { mode: 0o600 });
  chmodSync(credentialsPath, 0o600);
}

function readCredentialValue(provider, key) {
  const file = readCredentialsFile();
  return file.credentials.find((entry) => entry?.provider === provider && entry?.key === key && !entry.workspaceId && !entry.userId)?.value || '';
}

function writeCredentialValue(provider, key, value) {
  const trimmed = String(value || '').trim();
  if (!trimmed) return false;
  const file = readCredentialsFile();
  const now = new Date().toISOString();
  const existing = file.credentials.find((entry) => entry?.provider === provider && entry?.key === key && !entry.workspaceId && !entry.userId);
  const next = {
    provider,
    key,
    value: trimmed,
    createdAt: existing?.createdAt || now,
    updatedAt: now
  };
  if (existing) {
    Object.assign(existing, next);
  } else {
    file.credentials.push(next);
  }
  writeCredentialsFile(file);
  return true;
}

function writeConfigFile(config) {
  mkdirSync(path.dirname(configPath), { recursive: true, mode: 0o700 });
  writeFileSync(configPath, stringify(config, { lineWidth: 100 }), { mode: 0o600 });
}

function objectAt(target, key) {
  if (target[key] && typeof target[key] === 'object' && !Array.isArray(target[key])) return target[key];
  target[key] = {};
  return target[key];
}

function setPath(target, parts, value) {
  let cursor = target;
  for (const part of parts.slice(0, -1)) {
    cursor = objectAt(cursor, part);
  }
  cursor[parts[parts.length - 1]] = value;
}

function deletePath(target, parts) {
  let cursor = target;
  for (const part of parts.slice(0, -1)) {
    if (!cursor || typeof cursor !== 'object' || Array.isArray(cursor)) return;
    cursor = cursor[part];
  }
  if (!cursor || typeof cursor !== 'object' || Array.isArray(cursor)) return;
  delete cursor[parts[parts.length - 1]];
}

function getPath(target, parts) {
  let cursor = target;
  for (const part of parts) {
    if (!cursor || typeof cursor !== 'object' || Array.isArray(cursor)) return '';
    cursor = cursor[part];
  }
  return typeof cursor === 'string' || typeof cursor === 'number' ? String(cursor) : '';
}

function readConfigValue(key) {
  const config = readConfigFile();
  if (key === 'MURPH_APP_URL') return getPath(config, ['app', 'url']);
  if (key === 'MURPH_SQLITE_PATH') return getPath(config, ['app', 'sqlitePath']);
  if (key === 'MURPH_DEFAULT_PROVIDER') return getPath(config, ['ai', 'defaultProvider']);
  if (key === 'MURPH_DEFAULT_MODEL') return getPath(config, ['ai', 'defaultModel']);
  if (key === 'MURPH_AGENT_PROVIDER') return getPath(config, ['ai', 'agent', 'provider']);
  if (key === 'MURPH_AGENT_MODEL') return getPath(config, ['ai', 'agent', 'model']);
  if (key === 'SLACK_EVENTS_MODE') return getPath(config, ['channels', 'slack', 'eventsMode']);
  if (key === 'SLACK_CLIENT_ID') return getPath(config, ['channels', 'slack', 'clientId']);
  if (key === 'SLACK_APP_ID') return getPath(config, ['channels', 'slack', 'appId']);
  if (key === 'SLACK_TEAM_ID') return getPath(config, ['channels', 'slack', 'teamId']);
  if (key === 'SLACK_TEAM_NAME') return getPath(config, ['channels', 'slack', 'teamName']);
  if (key === 'DISCORD_CLIENT_ID') return getPath(config, ['channels', 'discord', 'clientId']);
  if (key === 'DISCORD_REDIRECT_URI') return getPath(config, ['channels', 'discord', 'redirectUri']);
  return '';
}

function readSetupValue(key) {
  const secretTarget = SECRET_KEY_MAP[key];
  if (process.env[key]) return process.env[key];
  if (secretTarget) {
    const value = readCredentialValue(secretTarget[0], secretTarget[1]);
    if (value) return value;
  }
  return readConfigValue(key);
}

function localSetupDefaults() {
  const setup = readConfigFile().setup;
  return setup && typeof setup === 'object' && !Array.isArray(setup) ? setup : {};
}

function currentChannelProvider() {
  return selectedChannelProvider || localSetupDefaults().channelProvider || 'slack';
}

function currentWorkspaceId() {
  return selectedWorkspaceId || localSetupDefaults().workspaceId || '';
}

function writeLocalSetupDefaults(nextValues) {
  const config = readConfigFile();
  const current = config.setup && typeof config.setup === 'object' && !Array.isArray(config.setup)
    ? config.setup
    : {};
  config.setup = {
    ...current,
    ...nextValues
  };
  writeConfigFile(config);
}

function writeSetupValues(values) {
  const secretValues = {};
  const configValues = {};
  for (const [key, value] of Object.entries(values)) {
    if (CONFIG_KEYS.has(key)) {
      configValues[key] = value;
    } else if (SECRET_KEY_MAP[key]) {
      secretValues[key] = value;
    } else {
      configValues[key] = value;
    }
  }

  const updated = [];

  for (const [key, rawValue] of Object.entries(secretValues)) {
    const value = String(rawValue || '').trim();
    if (!value) continue;
    const [provider, secretKey] = SECRET_KEY_MAP[key];
    writeCredentialValue(provider, secretKey, value);
    process.env[key] = value;
    updated.push(key);
  }

  const config = readConfigFile();
  for (const [key, rawValue] of Object.entries(configValues)) {
    const value = String(rawValue || '').trim();
    if (!value) {
      const clearer = CONFIG_KEY_CLEARERS[key];
      if (!clearer) continue;
      clearer(config);
      updated.push(key);
      continue;
    }
    CONFIG_KEY_SETTERS[key](config, value);
    process.env[key] = value;
    updated.push(key);
  }
  if (Object.keys(configValues).length > 0) {
    writeConfigFile(config);
  }

  return updated;
}

function mask(value) {
  if (!value) return 'missing';
  if (value.length <= 8) return 'configured';
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

function normalizeProvider(value, fallback = 'openai') {
  return value === 'anthropic' ? 'anthropic' : fallback === 'anthropic' ? 'anthropic' : 'openai';
}

function currentDefaultProvider() {
  return readSetupValue('MURPH_DEFAULT_PROVIDER') ||
    (readSetupValue('OPENAI_API_KEY') ? 'openai' : readSetupValue('ANTHROPIC_API_KEY') ? 'anthropic' : 'openai');
}

function currentDefaultModel(provider = currentDefaultProvider()) {
  return readSetupValue('MURPH_DEFAULT_MODEL') || DEFAULT_PROVIDER_MODEL[provider];
}

function currentAgentProvider(fallbackProvider = 'openai') {
  const configured = readSetupValue('MURPH_AGENT_PROVIDER');
  return configured ? normalizeProvider(configured, fallbackProvider) : fallbackProvider;
}

function currentAgentModel(provider, runtimeProvider = currentDefaultProvider()) {
  return readSetupValue('MURPH_AGENT_MODEL') ||
    (provider === runtimeProvider ? currentDefaultModel(runtimeProvider) : DEFAULT_AGENT_MODEL[provider]);
}

function hasAgentOverride() {
  return Boolean(readSetupValue('MURPH_AGENT_PROVIDER') || readSetupValue('MURPH_AGENT_MODEL'));
}

async function saveAgentModelDefaults(providerFallback) {
  const provider = currentAgentProvider(providerFallback);
  const model = currentAgentModel(provider, providerFallback);
  if (hasAgentOverride()) {
    success(`Murph Agent model is configured (${provider}/${model}).`);
    return;
  }
  success(`Murph Agent inherits runtime model (${provider}/${model}).`);
}

async function promptAgentModel(providerFallback) {
  sectionTitle('Murph Agent model');
  const runtimeModel = currentDefaultModel(providerFallback);
  const overrideChoice = await askChoice(
    `Murph Agent model: [1] Inherit runtime (${providerFallback}/${runtimeModel})  [2] Custom`,
    ['1', '2', 'inherit', 'custom'],
    hasAgentOverride() ? '2' : '1'
  );
  if (overrideChoice === '1' || overrideChoice.toLowerCase() === 'inherit') {
    const values = { MURPH_AGENT_PROVIDER: '', MURPH_AGENT_MODEL: '' };
    writeSetupValues(values);
    await postSetupConfig(values);
    success(`Murph Agent will inherit runtime model: ${providerFallback}/${runtimeModel}.`);
    return;
  }

  const existingProvider = currentAgentProvider(providerFallback);
  const providerInput = await askChoice(
    'Agent provider: [1] OpenAI  [2] Anthropic',
    ['1', '2', 'openai', 'anthropic'],
    existingProvider === 'anthropic' ? '2' : '1'
  );
  const provider = providerInput === '2' || providerInput.toLowerCase() === 'anthropic' ? 'anthropic' : 'openai';
  const recommended = DEFAULT_AGENT_MODEL[provider];
  const existingModel = currentAgentModel(provider, providerFallback);
  const defaultChoice = existingModel === recommended ? '1' : '2';
  const modelChoice = await ask(
    `Agent model: [1] Recommended (${recommended})  [2] Custom, or type a model id`,
    defaultChoice
  );
  const useCustom = modelChoice === '2' || modelChoice.toLowerCase() === 'custom';
  const model = modelChoice === '1' || modelChoice.toLowerCase() === 'recommended'
    ? recommended
    : useCustom
      ? await askRequired('Custom agent model id', existingModel === recommended ? '' : existingModel)
      : modelChoice.trim();
  const values = { MURPH_AGENT_PROVIDER: provider, MURPH_AGENT_MODEL: model };
  writeSetupValues(values);
  await postSetupConfig(values);
  success(`Saved Murph Agent model: ${provider}/${model}.`);
}

function slackRedirectUrl() {
  return `${murphUrl}/api/slack/oauth/callback`;
}

function slackAppConfigured() {
  return Boolean(readSetupValue('SLACK_APP_TOKEN') && readSetupValue('SLACK_CLIENT_ID') && readSetupValue('SLACK_CLIENT_SECRET'));
}

function slackOAuthConfigured() {
  return Boolean(readSetupValue('SLACK_CLIENT_ID') && readSetupValue('SLACK_CLIENT_SECRET'));
}

function isSlackAppLevelToken(value) {
  return String(value || '').trim().startsWith('xapp-');
}

function parseSlackAuthList(output) {
  const entries = [];
  const seen = new Set();
  const lines = String(output || '')
    .replace(/\x1b\[[0-9;]*m/g, '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  for (const line of lines) {
    const idMatch = line.match(/\bT[A-Z0-9]{2,}\b/);
    if (!idMatch || seen.has(idMatch[0])) continue;
    const cells = line
      .split(/[|│]/)
      .map((cell) => cell.trim())
      .filter(Boolean);
    const idCellIndex = cells.findIndex((cell) => cell.includes(idMatch[0]));
    const nearbyName = idCellIndex > 0
      ? cells[idCellIndex - 1]
      : idCellIndex >= 0 && cells[idCellIndex + 1]
        ? cells[idCellIndex + 1]
        : '';
    const parenName = line.match(/([^()|│]+)\(\s*T[A-Z0-9]{2,}\s*\)/)?.[1]?.trim();
    const leadingName = line.slice(0, idMatch.index).replace(/[-:]+$/, '').trim();
    const name = (parenName || nearbyName || leadingName || idMatch[0]).trim() || idMatch[0];
    entries.push({ id: idMatch[0], name });
    seen.add(idMatch[0]);
  }

  return entries;
}

function runSlackCli(args, stdio = 'pipe') {
  return spawnSync('slack', args, {
    cwd: appDir,
    encoding: 'utf8',
    stdio
  });
}

function listSlackCliWorkspaces() {
  if (!haveCommand('slack')) return [];
  const result = runSlackCli(['auth', 'list', '--skip-update', '--no-color']);
  if (result.status !== 0) return [];
  return parseSlackAuthList(`${result.stdout || ''}\n${result.stderr || ''}`);
}

async function selectSlackWorkspaceFromCli() {
  if (!haveCommand('slack')) {
    warn('Slack CLI was not found. The app configuration token will determine the Slack workspace.');
    return null;
  }

  const workspaces = listSlackCliWorkspaces();
  if (workspaces.length === 0) {
    warn('Slack CLI has no authorized workspace. The app configuration token will determine the Slack workspace.');
    return null;
  }
  if (workspaces.length === 1) {
    return workspaces[0];
  }

  info('Select the Slack workspace to configure:');
  numberedList(workspaces, (workspace) => `${workspace.name} (${workspace.id})`);
  return workspaces[await askIndex('Slack workspace', workspaces, 1)];
}

async function saveSlackWorkspaceContext(workspace) {
  if (!workspace?.id) return null;
  const values = {
    SLACK_TEAM_ID: workspace.id
  };
  if (workspace.name) values.SLACK_TEAM_NAME = workspace.name;
  writeSetupValues(values);
  await postSetupConfig(values);
  success(`Slack setup workspace: ${workspace.name || workspace.id} (${workspace.id}).`);
  return workspace;
}

async function ensureSlackWorkspaceContext() {
  const existingTeamId = readSetupValue('SLACK_TEAM_ID');
  if (existingTeamId) {
    return {
      id: existingTeamId,
      name: readSetupValue('SLACK_TEAM_NAME') || existingTeamId
    };
  }
  const selected = await selectSlackWorkspaceFromCli();
  return saveSlackWorkspaceContext(selected);
}

function renderSlackManifest() {
  if (!existsSync(slackManifestPath)) {
    fail(`Slack manifest is missing: ${slackManifestPath}`);
  }
  const manifest = parse(readFileSync(slackManifestPath, 'utf8')) ?? {};
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    fail('Slack manifest must contain a YAML object.');
  }
  setPath(manifest, ['oauth_config', 'redirect_urls'], [slackRedirectUrl()]);
  setPath(manifest, ['settings', 'socket_mode_enabled'], true);
  return manifest;
}

function slackCredentialsFromPayload(payload) {
  const app = payload?.app && typeof payload.app === 'object' ? payload.app : {};
  const credentials = payload?.credentials && typeof payload.credentials === 'object'
    ? payload.credentials
    : app.credentials && typeof app.credentials === 'object'
      ? app.credentials
      : {};
  return {
    appId: payload?.app_id || payload?.appId || app.id || app.app_id || credentials.app_id || readSetupValue('SLACK_APP_ID'),
    clientId: credentials.client_id || credentials.clientId || app.client_id || payload?.client_id || readSetupValue('SLACK_CLIENT_ID'),
    clientSecret: credentials.client_secret || credentials.clientSecret || app.client_secret || payload?.client_secret || readSetupValue('SLACK_CLIENT_SECRET'),
    signingSecret: credentials.signing_secret || credentials.signingSecret || app.signing_secret || payload?.signing_secret || readSetupValue('SLACK_SIGNING_SECRET'),
    appToken: credentials.app_token || credentials.appToken || app.app_token || payload?.app_token || payload?.appToken || readSetupValue('SLACK_APP_TOKEN'),
    teamId: payload?.team_id || payload?.teamId || app.team_id || app.teamId || credentials.team_id || readSetupValue('SLACK_TEAM_ID'),
    teamName: payload?.team_name || payload?.teamName || app.team_name || app.teamName || credentials.team_name || readSetupValue('SLACK_TEAM_NAME')
  };
}

async function slackManifestApi(method, token, body) {
  const response = await fetch(`${slackApiBase}/${method}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json; charset=utf-8'
    },
    body: JSON.stringify(body)
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.ok) {
    const details = Array.isArray(payload.errors)
      ? payload.errors
          .map((entry) => entry?.message || entry?.error || '')
          .filter(Boolean)
          .join('; ')
      : '';
    const error = payload.error || `Slack ${method} failed`;
    fail(details ? `${error}: ${details}` : error);
  }
  return payload;
}

function printSlackAppSettingsUrl(appId) {
  if (!appId) return;
  const settingsUrl = `https://api.slack.com/apps/${encodeURIComponent(appId)}/general`;
  info('Open Slack app settings:');
  callout('Slack app settings', settingsUrl);
}

async function saveSlackAppConfig(credentials, workspace = null) {
  const values = {
    SLACK_EVENTS_MODE: 'socket',
    SLACK_CLIENT_ID: credentials.clientId,
    SLACK_CLIENT_SECRET: credentials.clientSecret
  };
  if (credentials.appId) values.SLACK_APP_ID = credentials.appId;
  if (credentials.signingSecret) values.SLACK_SIGNING_SECRET = credentials.signingSecret;
  if (credentials.appToken) values.SLACK_APP_TOKEN = credentials.appToken;
  if (credentials.teamId || workspace?.id) values.SLACK_TEAM_ID = credentials.teamId || workspace.id;
  if (credentials.teamName || workspace?.name) values.SLACK_TEAM_NAME = credentials.teamName || workspace.name;
  const updated = writeSetupValues(values);
  await postSetupConfig(values);
  success(`Saved Slack app config: ${updated.join(', ')}`);
}

async function trySlackManifestAutomation(workspace = null) {
  if (slackAppConfigured()) return true;
  if (haveCommand('slack')) {
    info('Slack CLI detected. Murph will use it where possible and fall back to manual setup if needed.');
  } else {
    warn('Slack CLI was not found. Trying direct Slack manifest setup, then falling back to manual setup if needed.');
  }

  const workspaceLabel = workspace?.id ? ` for ${workspace.name || workspace.id}` : '';
  info(`Provide a Slack app configuration token${workspaceLabel}. Murph uses it once to create the app from the manifest, then discards it.`);
  const existingToken = process.env.MURPH_SLACK_CONFIG_TOKEN || '';
  const token = existingToken || await askSecret(`Slack app configuration token${workspaceLabel} (blank for manual setup)`);
  if (!token.trim()) {
    fail('Slack app configuration token was not provided.');
  }
  if (isSlackAppLevelToken(token)) {
    warn('That looks like a Slack app-level token, not an app configuration token.');
    const values = { SLACK_APP_TOKEN: token.trim() };
    writeSetupValues(values);
    await postSetupConfig(values);
    fail('Saved it as SLACK_APP_TOKEN. Slack app OAuth credentials are still missing.');
  }

  const staleAppId = readSetupValue('SLACK_APP_ID');
  if (staleAppId && !slackAppConfigured()) {
    warn(`Saved Slack app ID ${staleAppId} is incomplete without OAuth credentials. Creating a fresh Slack app.`);
  }
  const manifest = renderSlackManifest();
  const manifestBody = JSON.stringify(manifest);
  const payload = await slackManifestApi('apps.manifest.create', token.trim(), { manifest: manifestBody });
  const credentials = slackCredentialsFromPayload(payload);
  if (!credentials.clientId || !credentials.clientSecret) {
    fail('Slack manifest response did not include client credentials.');
  }

  await saveSlackAppConfig(credentials, workspace);
  return true;
}

async function promptSlackAppToken(appId = readSetupValue('SLACK_APP_ID')) {
  if (readSetupValue('SLACK_APP_TOKEN')) return;
  if (options.nonInteractive) {
    fail('Missing Slack app-level token. Set SLACK_APP_TOKEN, or run murph setup slack interactively.');
  }
  if (appId) {
    printSlackAppSettingsUrl(appId);
    info('Create or copy the app-level token (xapp-...), then paste it here.');
  }
  const token = await askRequired('Slack app-level token (xapp-...)', readSetupValue('SLACK_APP_TOKEN'));
  const values = { SLACK_APP_TOKEN: token };
  writeSetupValues(values);
  await postSetupConfig(values);
  success(`Saved Slack app-level token (${mask(token)}).`);
}

async function promptManualSlackConfig() {
  if (options.nonInteractive) {
    fail('Missing Slack app settings. Set SLACK_APP_TOKEN, SLACK_CLIENT_ID, and SLACK_CLIENT_SECRET.');
  }
  info('Use docs/public/slack-manifest.yaml and this redirect URL:');
  callout('Redirect URL', slackRedirectUrl());
  const values = { SLACK_EVENTS_MODE: 'socket' };
  if (!readSetupValue('SLACK_APP_TOKEN')) {
    values.SLACK_APP_TOKEN = await askRequired('Slack app-level token (xapp-...)');
  }
  if (!readSetupValue('SLACK_CLIENT_ID')) {
    values.SLACK_CLIENT_ID = await askRequired('Slack client ID');
  }
  if (!readSetupValue('SLACK_CLIENT_SECRET')) {
    values.SLACK_CLIENT_SECRET = await askRequired('Slack client secret');
  }
  const signingSecret = await askSecret('Slack signing secret (optional)', readSetupValue('SLACK_SIGNING_SECRET'));
  if (signingSecret.trim()) values.SLACK_SIGNING_SECRET = signingSecret.trim();
  writeSetupValues(values);
  await postSetupConfig(values);
}

async function ensureSlackAppConfig(workspace = null) {
  if (slackAppConfigured()) {
    success('Slack app settings are configured.');
    return;
  }
  if (options.quick) {
    if (options.nonInteractive) {
      fail('Missing Slack app settings. Set SLACK_APP_TOKEN, SLACK_CLIENT_ID, and SLACK_CLIENT_SECRET.');
    }
    info('Slack app settings are incomplete.');
  }
  if (slackOAuthConfigured()) {
    await promptSlackAppToken();
    if (slackAppConfigured()) return;
  }

  try {
    await trySlackManifestAutomation(workspace);
    await promptSlackAppToken();
  } catch (error) {
    warn(`Slack app automation failed: ${error instanceof Error ? error.message : String(error)}`);
    if (options.nonInteractive) {
      fail('Slack setup cannot continue non-interactively without complete Slack app settings.');
    }
    warn('Falling back to manual Slack app setup.');
    await promptManualSlackConfig();
  }

  if (!slackAppConfigured()) {
    await promptManualSlackConfig();
  }
  if (!slackAppConfigured()) {
    fail('Slack app settings are still incomplete.');
  }
}

function slackInstallUrl(workspace = null) {
  const teamId = workspace?.id || readSetupValue('SLACK_TEAM_ID');
  const params = new URLSearchParams({ source: 'cli' });
  if (teamId) params.set('team', teamId);
  return `${murphUrl}/api/slack/install?${params.toString()}`;
}

function slackWorkspaceMatches(status, workspace = null) {
  const targetTeamId = workspace?.id || readSetupValue('SLACK_TEAM_ID');
  if (!targetTeamId || !status.slack?.installed) return Boolean(status.slack?.installed);
  const connectedTeamId = status.slack?.workspace?.externalWorkspaceId;
  return !connectedTeamId || connectedTeamId === targetTeamId;
}

function assertSlackWorkspaceMatch(status, workspace = null) {
  const targetTeamId = workspace?.id || readSetupValue('SLACK_TEAM_ID');
  const connectedTeamId = status.slack?.workspace?.externalWorkspaceId;
  if (targetTeamId && connectedTeamId && connectedTeamId !== targetTeamId) {
    fail(`Connected Slack workspace ${connectedTeamId}, but setup selected ${targetTeamId}. Re-run murph setup slack and connect the selected workspace.`);
  }
}

function discordInstallUrl(clientId = readSetupValue('DISCORD_CLIENT_ID')) {
  if (!clientId) return '';
  const params = new URLSearchParams({ source: 'setup' });
  return `${murphUrl}/api/discord/install?${params.toString()}`;
}

function discordRedirectUrl() {
  return readSetupValue('DISCORD_REDIRECT_URI') || `${murphUrl}/api/discord/oauth/callback`;
}

function discordDeveloperPortalOAuthUrl(applicationId) {
  return `https://discord.com/developers/applications/${encodeURIComponent(applicationId)}/oauth2`;
}

async function discordApi(pathname, token, options = {}) {
  const response = await fetch(`${discordApiBase}${pathname}`, {
    ...options,
    headers: {
      authorization: `Bot ${token}`,
      ...(options.body ? { 'content-type': 'application/json; charset=utf-8' } : {}),
      ...(options.headers || {})
    }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = payload.message || payload.error || `Discord API request failed: ${pathname}`;
    fail(error);
  }
  return payload;
}

async function fetchDiscordApplication(token) {
  return discordApi('/oauth2/applications/@me', token).catch(() => ({}));
}

function discordRedirectUris(application) {
  return Array.isArray(application?.redirect_uris)
    ? application.redirect_uris.filter((uri) => typeof uri === 'string' && uri.trim()).map((uri) => uri.trim())
    : undefined;
}

function discordRedirectUriRegistered(application, redirectUri) {
  const redirectUris = discordRedirectUris(application);
  return redirectUris === undefined ? undefined : redirectUris.includes(redirectUri);
}

async function validateDiscordBotToken(token) {
  const bot = await discordApi('/users/@me', token);
  const app = await fetchDiscordApplication(token);
  return {
    botUserId: bot.id,
    botName: bot.global_name || bot.username || bot.id,
    applicationId: app.id || bot.id,
    applicationName: app.name,
    applicationFlags: typeof app.flags === 'number' ? app.flags : undefined,
    applicationRedirectUris: discordRedirectUris(app)
  };
}

async function ensureDiscordRedirectUriConfigured(token, applicationId, redirectUri, knownRedirectUris) {
  const registered = knownRedirectUris === undefined ? undefined : knownRedirectUris.includes(redirectUri);
  if (registered === true) {
    success('Discord OAuth redirect URI is registered.');
    return true;
  }
  if (registered === undefined) {
    warn('Murph could not verify Discord OAuth redirect URIs from the Discord API.');
    info('Make sure this redirect URI is registered in Discord Developer Portal > OAuth2 > General > Redirects before authorizing Murph.');
    callout('Redirect URI', redirectUri);
    callout('Discord Developer Portal', discordDeveloperPortalOAuthUrl(applicationId));
    return false;
  }

  warn('Discord OAuth redirect URI is not registered yet.');
  info('Add this exact URI in Discord Developer Portal > OAuth2 > General > Redirects, then save changes.');
  callout('Redirect URI', redirectUri);
  callout('Discord Developer Portal', discordDeveloperPortalOAuthUrl(applicationId));
  if (options.nonInteractive) {
    fail(`Missing Discord OAuth redirect URI. Add ${redirectUri} in Discord Developer Portal before running non-interactively.`);
  }

  await ask('Press Enter after adding the Discord redirect URI.');
  const refreshedApp = await fetchDiscordApplication(token);
  const refreshedRegistered = discordRedirectUriRegistered(refreshedApp, redirectUri);
  if (refreshedRegistered === true) {
    success('Discord OAuth redirect URI is registered.');
    return true;
  }
  if (refreshedRegistered === false) {
    fail(`Discord OAuth redirect URI is still missing: ${redirectUri}`);
  }

  warn('Murph still could not verify Discord OAuth redirect URIs from the Discord API. Continuing with the URI you confirmed.');
  return false;
}

async function configureDiscordApplication(token, applicationFlags) {
  const flags = typeof applicationFlags === 'number'
    ? applicationFlags | discordRequiredLimitedIntentFlags
    : undefined;
  try {
    await discordApi('/applications/@me', token, {
      method: 'PATCH',
      body: JSON.stringify({
        install_params: {
          scopes: ['bot'],
          permissions: discordBotPermissions
        },
        integration_types_config: {
          0: {
            oauth2_install_params: {
              scopes: ['bot'],
              permissions: discordBotPermissions
            }
          }
        },
        ...(flags === undefined ? {} : { flags })
      })
    });
    success(flags === undefined
      ? 'Saved Discord bot install permissions.'
      : 'Saved Discord bot install permissions and privileged intent settings.');
    if (flags === undefined) {
      warn('Could not read current Discord app flags, so privileged intents may still need to be enabled manually.');
    }
    return true;
  } catch (error) {
    warn(`Discord app configuration automation failed: ${error instanceof Error ? error.message : String(error)}`);
    warn('If Discord blocks the API update, open Developer Portal > Bot and enable Server Members Intent and Message Content Intent.');
    warn(`Set bot install permissions to: ${discordPermissionLabels.join(', ')}.`);
    return false;
  }
}

async function discoverDiscordGuilds(token) {
  try {
    const guilds = await discordApi('/users/@me/guilds?limit=200', token);
    return Array.isArray(guilds)
      ? guilds
          .filter((guild) => guild?.id)
          .map((guild) => ({ id: String(guild.id), name: guild.name || String(guild.id) }))
      : [];
  } catch (error) {
    warn(`Discord REST guild discovery failed: ${error instanceof Error ? error.message : String(error)}`);
    return [];
  }
}

async function fetchDiscordGuild(token, guildId) {
  const guild = await discordApi(`/guilds/${encodeURIComponent(guildId)}`, token);
  return {
    id: String(guild.id || guildId),
    name: guild.name || String(guild.id || guildId)
  };
}

function isStaleDiscordGuildRouteError(error) {
  return error instanceof Error &&
    error.status === 404 &&
    error.pathname === '/api/discord/guild' &&
    (error.payload?.error === 'not_found' || error.message === 'not_found');
}

async function postDiscordGuild(guild) {
  return request('/api/discord/guild', {
    method: 'POST',
    body: JSON.stringify({ guildId: guild.id })
  });
}

async function restartMurphAfterStaleSetupApi() {
  warn('Discord is connected, but the local Murph server is running an older setup API. Restarting Murph and retrying...');
  runMurphCommand(['restart']);
  for (let i = 0; i < 20; i += 1) {
    if (await health()) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  fail(`Murph did not become healthy at ${murphUrl}. Run: murph logs`);
}

async function saveDiscordGuild(guild) {
  let payload;
  try {
    payload = await postDiscordGuild(guild);
  } catch (error) {
    if (!isStaleDiscordGuildRouteError(error)) {
      throw error;
    }
    await restartMurphAfterStaleSetupApi();
    try {
      payload = await postDiscordGuild(guild);
    } catch (retryError) {
      if (isStaleDiscordGuildRouteError(retryError)) {
        fail('Discord is connected, but Murph still cannot save it because the local server is running an older build. Run: murph build && murph restart');
      }
      throw retryError;
    }
  }
  await rememberSetupWorkspace('discord', payload.workspace?.id);
  success(`${payload.workspace?.name || guild.name || 'Discord server'} connected.`);
}

async function rememberSetupWorkspace(provider, workspaceId) {
  if (!workspaceId) return;
  const current = localSetupDefaults();
  const changed = current.channelProvider !== provider || current.workspaceId !== workspaceId;
  const next = changed
    ? {
        channelProvider: provider,
        workspaceId,
        ownerUserId: '',
        ownerDisplayName: '',
        channelScopeMode: 'selected',
        selectedChannels: [],
        timezone: current.timezone,
        workdayStartHour: current.workdayStartHour,
        workdayEndHour: current.workdayEndHour
      }
    : {
        ...current,
        channelProvider: provider,
        workspaceId
      };
  selectedChannelProvider = provider;
  selectedWorkspaceId = workspaceId;
  writeLocalSetupDefaults(next);
  if (await health()) {
    await saveDefaults(next);
  }
}

async function chooseAndSaveDiscordGuild(token, guilds) {
  if (guilds.length > 0) {
    const configuredGuildId = process.env.MURPH_DISCORD_GUILD_ID;
    const configuredGuild = configuredGuildId
      ? guilds.find((guild) => guild.id === configuredGuildId) ?? await fetchDiscordGuild(token, configuredGuildId)
      : null;
    if (configuredGuild) {
      await saveDiscordGuild(configuredGuild);
      return;
    }
    info('Choose the Discord server Murph should use.');
    numberedList(guilds, (guild) => `${guild.name} (${guild.id})`);
    const selected = guilds[await askIndex('Discord server', guilds, 1)];
    await saveDiscordGuild(selected);
    return;
  }
  info('If the bot is installed but Murph did not detect it, paste the Discord server ID to finish setup.');
  const guildId = process.env.MURPH_DISCORD_GUILD_ID || await ask('Discord server ID (blank to stop)');
  if (!guildId.trim()) {
    fail('Discord bot installation was not detected yet. Re-run: murph setup discord');
  }
  await saveDiscordGuild(await fetchDiscordGuild(token, guildId.trim()));
}

async function request(pathname, options = {}) {
  const response = await fetch(`${murphUrl}${pathname}`, {
    ...options,
    headers: {
      ...(options.body ? { 'content-type': 'application/json' } : {}),
      ...(options.headers || {})
    }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.error || `Request failed: ${pathname}`);
    error.status = response.status;
    error.pathname = pathname;
    error.payload = payload;
    throw error;
  }
  return payload;
}

async function fetchSetupMember(provider, workspaceId, userId) {
  const params = new URLSearchParams({ provider, userId });
  if (workspaceId) params.set('workspaceId', workspaceId);
  const payload = await request(`/api/setup/member?${params.toString()}`);
  return payload.member;
}

async function fetchSetupChannel(provider, workspaceId, channelId) {
  const params = new URLSearchParams({ provider, channelId });
  if (workspaceId) params.set('workspaceId', workspaceId);
  const payload = await request(`/api/setup/channel?${params.toString()}`);
  return payload.channel;
}

async function health() {
  try {
    await request('/api/health');
    return true;
  } catch {
    return false;
  }
}

async function postSetupConfig(values) {
  if (!(await health())) return;
  try {
    await request('/api/setup/config', {
      method: 'POST',
      body: JSON.stringify(values)
    });
  } catch (error) {
    const hasLocalConfigValues = Object.keys(values).some((key) => CONFIG_KEYS.has(key));
    const isUnsupportedSetupKey = error instanceof Error && error.message.includes('Unsupported setup key');
    if (!hasLocalConfigValues || !isUnsupportedSetupKey) {
      throw error;
    }

    const setupValues = Object.fromEntries(
      Object.entries(values).filter(([key, value]) => !CONFIG_KEYS.has(key) && String(value || '').trim())
    );
    if (Object.keys(setupValues).length > 0) {
      await request('/api/setup/config', {
        method: 'POST',
        body: JSON.stringify(setupValues)
      });
    }
    warn('Saved local config. Restart Murph if the running server does not show the new model settings yet.');
  }
}

function runMurphCommand(args) {
  const binPath = path.join(appDir, 'bin', 'murph');
  const result = spawnSync('bash', [binPath, ...args], {
    cwd: appDir,
    stdio: 'inherit',
    env: { ...process.env, MURPH_APP_DIR: appDir, MURPH_URL: murphUrl }
  });
  if (result.status !== 0) {
    fail(`murph ${args.join(' ')} failed.`);
  }
}

async function ensureServer() {
  if (await health()) return;
  if (!existsSync(path.join(appDir, 'dist', 'server', 'index.js'))) {
    fail('Murph is not built yet. Run: murph build');
  }
  runMurphCommand(['start', '--background']);
  for (let i = 0; i < 20; i += 1) {
    if (await health()) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  fail(`Murph did not become healthy at ${murphUrl}. Run: murph logs`);
}

function browserOpenCommand(url) {
  if (process.env.MURPH_BROWSER_OPEN_COMMAND) {
    return { command: process.env.MURPH_BROWSER_OPEN_COMMAND, args: [url] };
  }
  if (!output.isTTY) return null;
  if (process.platform === 'darwin') return { command: 'open', args: [url] };
  if (process.platform === 'win32') return { command: 'cmd', args: ['/c', 'start', '', url] };
  return { command: 'xdg-open', args: [url] };
}

function openBrowserUrl(url) {
  if (options.nonInteractive) return false;
  const opener = browserOpenCommand(url);
  if (!opener) return false;
  const result = spawnSync(opener.command, opener.args, { stdio: 'ignore' });
  if (result.status === 0 && !result.error) return true;
  warn('Murph could not open the browser automatically. Use the URL above to continue.');
  return false;
}

async function setupCore() {
  sectionTitle('Core');
  mkdirSync(path.join(appDir, 'data'), { recursive: true });
  const values = {};
  if (!readSetupValue('MURPH_APP_URL')) values.MURPH_APP_URL = murphUrl;
  if (!readSetupValue('MURPH_SQLITE_PATH')) values.MURPH_SQLITE_PATH = 'data/murph.sqlite';
  if (!readSetupValue('SLACK_EVENTS_MODE')) values.SLACK_EVENTS_MODE = 'socket';
  const updated = writeSetupValues(values);
  if (updated.length > 0) {
    success(`Updated configuration: ${updated.join(', ')}`);
  } else {
    success('Core configuration values are present.');
  }
}

async function setupAi() {
  sectionTitle('AI provider');
  const currentProvider = currentDefaultProvider();
  const hasKey = Boolean(readSetupValue('OPENAI_API_KEY') || readSetupValue('ANTHROPIC_API_KEY'));
  if (options.quick && hasKey) {
    success(`AI provider is configured (${currentProvider}).`);
    await saveAgentModelDefaults(currentProvider);
    return;
  }
  if (options.nonInteractive && !hasKey) {
    fail('Missing AI provider key. Set OPENAI_API_KEY or ANTHROPIC_API_KEY, or run murph setup provider.');
  }
  if (options.nonInteractive) {
    await saveAgentModelDefaults(currentProvider);
    return;
  }

  const providerInput = await askChoice('Provider: [1] OpenAI  [2] Anthropic', ['1', '2', 'openai', 'anthropic'], currentProvider === 'anthropic' ? '2' : '1');
  const provider = providerInput === '2' || providerInput.toLowerCase() === 'anthropic' ? 'anthropic' : 'openai';
  const keyName = provider === 'anthropic' ? 'ANTHROPIC_API_KEY' : 'OPENAI_API_KEY';
  const existing = readSetupValue(keyName);
  const key = await askRequired(
    existing
      ? `${provider === 'anthropic' ? 'Anthropic' : 'OpenAI'} API key (leave blank to keep current)`
      : `${provider === 'anthropic' ? 'Anthropic' : 'OpenAI'} API key`,
    existing
  );
  const values = { MURPH_DEFAULT_PROVIDER: provider, [keyName]: key };
  writeSetupValues(values);
  await postSetupConfig(values);
  success(`Saved ${provider} key (${mask(key)}).`);
  await promptAgentModel(provider);
}

async function setupChannelProvider() {
  sectionTitle('Channel provider');
  const current = currentChannelProvider();
  if (options.quick && current) {
    selectedChannelProvider = current;
    success(`Channel provider is configured: ${current}.`);
    return current;
  }
  if (options.nonInteractive) {
    selectedChannelProvider = current;
    return current;
  }
  const choice = await askChoice('Channel: [1] Slack  [2] Discord', ['1', '2', 'slack', 'discord'], current === 'discord' ? '2' : '1');
  const provider = choice === '2' || choice.toLowerCase() === 'discord' ? 'discord' : 'slack';
  selectedChannelProvider = provider;
  writeLocalSetupDefaults({ channelProvider: provider });
  success(`Selected channel provider: ${provider}.`);
  return provider;
}

async function setupSlack() {
  selectedChannelProvider = 'slack';
  sectionTitle('Slack');
  const workspace = await ensureSlackWorkspaceContext();
  await ensureSlackAppConfig(workspace);

  await ensureServer();
  let status = await request('/api/setup/status');
  assertSlackWorkspaceMatch(status, workspace);
  if (slackWorkspaceMatches(status, workspace) && !options.reconnectSearch) {
    const label = status.slack?.workspace?.name || workspace?.name || 'Slack workspace';
    await rememberSetupWorkspace('slack', status.slack?.workspace?.id);
    success(`${label} is connected.`);
    return;
  }

  const installUrl = slackInstallUrl(workspace);
  info('Slack app config is saved. Opening this URL to install Murph in your Slack workspace:');
  callout('Slack install URL', installUrl);
  openBrowserUrl(installUrl);
  if (options.nonInteractive) {
    fail('Slack app installation is not complete.');
  }
  await ask('Press Enter after Slack app installation finishes.');
  for (let i = 0; i < 20; i += 1) {
    status = await request('/api/setup/status');
    assertSlackWorkspaceMatch(status, workspace);
    if (slackWorkspaceMatches(status, workspace)) {
      const label = status.slack?.workspace?.name || workspace?.name || 'Slack workspace';
      await rememberSetupWorkspace('slack', status.slack?.workspace?.id);
      success(`${label} connected.`);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  fail('Slack app installation did not complete yet. Re-run: murph setup slack');
}

async function setupDiscord() {
  selectedChannelProvider = 'discord';
  sectionTitle('Discord');
  const existingToken = readSetupValue('DISCORD_BOT_TOKEN');
  if (options.nonInteractive && !existingToken) {
    fail('Missing Discord bot token. Set DISCORD_BOT_TOKEN, or run murph setup discord interactively.');
  }
  const token = process.env.DISCORD_BOT_TOKEN
    ? process.env.DISCORD_BOT_TOKEN.trim()
    : await askRequired('Discord bot token', existingToken);
  const existingClientSecret = readSetupValue('DISCORD_CLIENT_SECRET');
  if (options.nonInteractive && !existingClientSecret) {
    fail('Missing Discord client secret. Set DISCORD_CLIENT_SECRET, or run murph setup discord interactively.');
  }
  const clientSecret = process.env.DISCORD_CLIENT_SECRET
    ? process.env.DISCORD_CLIENT_SECRET.trim()
    : await askRequired('Discord client secret', existingClientSecret);
  const bot = await validateDiscordBotToken(token);
  const values = {
    DISCORD_BOT_TOKEN: token,
    DISCORD_CLIENT_ID: bot.applicationId,
    DISCORD_CLIENT_SECRET: clientSecret
  };
  writeSetupValues(values);
  await postSetupConfig(values);
  success(`Discord bot validated: ${bot.botName} (${bot.botUserId}).`);
  const configuredApp = await configureDiscordApplication(token, bot.applicationFlags);

  await ensureServer();
  let status = await request('/api/setup/status');
  if (status.discord?.installed && status.discord?.ownerConfigured !== false) {
    await rememberSetupWorkspace('discord', status.discord.workspace?.id);
    success(`${status.discord.workspace?.name || 'Discord server'} is connected.`);
    if (configuredApp) {
      const reinstallUrl = discordInstallUrl(bot.applicationId);
      if (reinstallUrl) {
        info('If this bot was installed before setup configured permissions, re-open the Discord install URL and approve the updated server permissions.');
        callout('Discord install URL', reinstallUrl);
      }
    }
    return;
  }

  const installUrl = discordInstallUrl(bot.applicationId);
  if (!installUrl) {
    fail('Discord application ID is missing.');
  }
  const redirectUri = discordRedirectUrl();
  await ensureDiscordRedirectUriConfigured(token, bot.applicationId, redirectUri, bot.applicationRedirectUris);
  info('Install Murph in your Discord server and approve account identification with this URL:');
  callout('Discord install URL', installUrl);
  info(`Murph requests these bot permissions: ${discordPermissionLabels.join(', ')}.`);
  if (!configuredApp) {
    info('In the Discord Developer Portal, enable Server Members Intent and Message Content Intent before continuing.');
  }
  openBrowserUrl(installUrl);
  if (options.nonInteractive) {
    fail('Discord authorization is not complete.');
  }
  const skipInstallConfirm = process.env.MURPH_DISCORD_SKIP_INSTALL_CONFIRM === '1';
  if (skipInstallConfirm) {
    info('Continuing after Discord authorization prompt was skipped by environment.');
  } else {
    await ask('Press Enter after Discord authorization finishes.');
  }
  const pollAttempts = skipInstallConfirm ? 1 : 40;
  for (let i = 0; i < pollAttempts; i += 1) {
    status = await request('/api/setup/status');
    if (status.discord?.installed) {
      await rememberSetupWorkspace('discord', status.discord.workspace?.id);
      if (status.discord?.ownerConfigured !== false) {
        success(`${status.discord.workspace?.name || 'Discord server'} connected and owner identified.`);
        return;
      }
      warn(`${status.discord.workspace?.name || 'Discord server'} connected, but Murph did not receive the Discord user identity.`);
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  info('Checking Discord servers for the installed bot...');
  const discoveredGuilds = await discoverDiscordGuilds(token);
  if (discoveredGuilds.length === 1) {
    await saveDiscordGuild(discoveredGuilds[0]);
    return;
  }
  await chooseAndSaveDiscordGuild(token, discoveredGuilds);
}

async function getDefaults() {
  await ensureServer();
  const workspaceId = currentWorkspaceId();
  return request(`/api/setup/defaults${workspaceId ? `?workspaceId=${encodeURIComponent(workspaceId)}` : ''}`);
}

async function saveDefaults(defaults) {
  await ensureServer();
  return request('/api/setup/defaults', {
    method: 'PUT',
    body: JSON.stringify({
      ...defaults,
      channelProvider: defaults.channelProvider || currentChannelProvider(),
      workspaceId: defaults.workspaceId || currentWorkspaceId()
    })
  });
}

function numberedList(items, formatter) {
  items.forEach((item, index) => {
    console.log(`  ${paint('secondary', String(index + 1).padStart(2, ' '))}. ${formatter(item)}`);
  });
}

async function setupIdentity() {
  sectionTitle('Identity');
  const provider = currentChannelProvider();
  const workspaceId = currentWorkspaceId();
  const current = await getDefaults();
  if (options.quick && current.defaults?.ownerUserId) {
    success(`Owner is configured: ${current.defaults.ownerDisplayName || current.defaults.ownerUserId}`);
    return current.defaults;
  }
  if (options.nonInteractive && !current.defaults?.ownerUserId) {
    fail('Missing owner identity. Run murph setup identity.');
  }
  if (section !== 'identity' && current.defaults?.ownerUserId) {
    success(`Owner is configured: ${current.defaults.ownerDisplayName || current.defaults.ownerUserId}`);
    return current.defaults;
  }

  let membersPayload = { members: [] };
  try {
    const params = new URLSearchParams({ provider });
    if (workspaceId) params.set('workspaceId', workspaceId);
    membersPayload = await request(`/api/setup/members?${params.toString()}`);
  } catch (error) {
    if (provider !== 'discord') throw error;
    warn(`Discord member list is unavailable: ${error instanceof Error ? error.message : String(error)}`);
    warn('Enable Server Members Intent in the Discord Developer Portal to use the member picker.');
  }
  const members = membersPayload.members || [];
  if (!members.length) {
    if (provider === 'discord') {
      const id = await askRequired('Discord user ID');
      try {
        const member = await fetchSetupMember(provider, workspaceId, id);
        if (member?.displayName) {
          return (await saveDefaults({ ...current.defaults, ownerUserId: member.id || id, ownerDisplayName: member.displayName })).defaults;
        }
      } catch (error) {
        warn(`Could not fetch that Discord user: ${error instanceof Error ? error.message : String(error)}`);
        warn('Continuing with manual display name. No separate Discord API key is needed.');
      }
      const displayName = await askRequired('Display name', id);
      return (await saveDefaults({ ...current.defaults, ownerUserId: id, ownerDisplayName: displayName })).defaults;
    }
    const displayName = await askRequired('Display name');
    const defaultId = displayName.toLowerCase().replace(/\s+/g, '_');
    const id = await askRequired('User ID', defaultId);
    return (await saveDefaults({ ...current.defaults, ownerUserId: id, ownerDisplayName: displayName })).defaults;
  }

  info(`Choose the ${provider === 'discord' ? 'Discord' : 'Slack'} user Murph should watch for.`);
  numberedList(members, (member) => member.displayName);
  const defaultIndex = Math.max(1, members.findIndex((member) => member.id === current.defaults?.ownerUserId) + 1);
  const selectedMember = members[await askIndex('Choose yourself', members, defaultIndex || 1)];
  const next = {
    ...current.defaults,
    ownerUserId: selectedMember.id,
    ownerDisplayName: selectedMember.displayName
  };
  await saveDefaults(next);
  success(`Saved owner: ${selectedMember.displayName}`);
  return next;
}

async function setupChannels() {
  sectionTitle('Channels');
  const provider = currentChannelProvider();
  const workspaceId = currentWorkspaceId();
  const current = await getDefaults();
  const hasChannels = current.defaults?.channelScopeMode === 'all_accessible' ||
    (current.defaults?.selectedChannels?.length || 0) > 0;
  if (options.quick && hasChannels) {
    success(current.defaults.channelScopeMode === 'all_accessible'
      ? 'Watching all accessible channels.'
      : `Watching ${current.defaults.selectedChannels.length} selected channel(s).`);
    return current.defaults;
  }
  if (options.nonInteractive && !hasChannels) {
    fail('Missing channel defaults. Run murph setup channels.');
  }

  const params = new URLSearchParams({ provider });
  if (workspaceId) params.set('workspaceId', workspaceId);
  let payload;
  try {
    payload = await request(`/api/setup/channels?${params.toString()}`);
  } catch (error) {
    if (provider !== 'discord') throw error;
    return setupDiscordChannelsManually(current, workspaceId, error);
  }
  const channels = payload.channels || [];
  if (channels.length === 0) {
    const next = { ...current.defaults, channelScopeMode: 'all_accessible', selectedChannels: [] };
    await saveDefaults(next);
    info('No channels returned. Saved all accessible channels.');
    return next;
  }

  info('Choose watched channels, or type "all".');
  numberedList(channels, (channel) => `${channel.displayName} (${channel.isPrivate ? 'private' : channel.isMember ? 'joined' : 'public'})`);
  const existing = (current.defaults?.selectedChannels || []).map((channel) => channel.id);
  const defaultAnswer = existing.length > 0
    ? existing.map((id) => channels.findIndex((channel) => channel.id === id) + 1).filter(Boolean).join(',')
    : 'all';
  const selection = await askChannelSelection(defaultAnswer, channels);
  const next = selection.mode === 'all_accessible'
    ? { ...current.defaults, channelScopeMode: 'all_accessible', selectedChannels: [] }
    : {
        ...current.defaults,
        channelScopeMode: 'selected',
        selectedChannels: selection.channels
      };
  await saveDefaults(next);
  success(next.channelScopeMode === 'all_accessible'
    ? 'Saved channel scope: all accessible channels.'
    : `Saved ${next.selectedChannels.length} selected channel(s).`);
  return next;
}

async function setupDiscordChannelsManually(current, workspaceId, cause) {
  warn(`Discord channel list is unavailable: ${cause instanceof Error ? cause.message : String(cause)}`);
  warn('Likely causes: the bot is not installed in this server, lacks View Channels, or needs re-approval after permission changes.');
  const installUrl = discordInstallUrl();
  if (installUrl) {
    info('Ask a server admin to re-open this install URL and approve the requested permissions.');
    callout('Discord install URL', installUrl);
  }
  if (options.nonInteractive) {
    fail('Missing Discord channel defaults. Re-approve the bot permissions or run murph setup channels interactively.');
  }

  const answer = await askRequired('Discord channel ID(s), comma-separated');
  const ids = [...new Set(answer.split(',').map((entry) => entry.trim()).filter(Boolean))];
  if (!ids.length) {
    fail('At least one Discord channel ID is required.');
  }

  const channels = [];
  for (const id of ids) {
    try {
      const channel = await fetchSetupChannel('discord', workspaceId, id);
      channels.push({ id: channel.id || id, displayName: channel.displayName || id });
    } catch (error) {
      fail(`Could not validate Discord channel ${id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const next = {
    ...current.defaults,
    channelScopeMode: 'selected',
    selectedChannels: channels
  };
  await saveDefaults(next);
  success(`Saved ${channels.length} selected Discord channel(s).`);
  return next;
}

async function setupSchedule() {
  sectionTitle('Schedule');
  const current = await getDefaults();
  if (options.quick && current.defaults?.timezone && current.defaults?.workdayStartHour !== undefined) {
    success(`Schedule is configured: ${current.defaults.workdayStartHour}:00 ${current.defaults.timezone}`);
    return current.defaults;
  }
  if (options.nonInteractive && (!current.defaults?.timezone || current.defaults?.workdayStartHour === undefined)) {
    fail('Missing schedule defaults. Run murph setup schedule.');
  }
  if (!current.defaults?.ownerUserId) {
    fail('Choose an owner first: murph setup identity');
  }

  const timezone = await ask('Timezone', current.defaults.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Los_Angeles');
  const startHour = await askHour('Workday start hour (0-23)', current.defaults.workdayStartHour ?? 9);
  const next = {
    ...current.defaults,
    timezone,
    workdayStartHour: startHour,
    workdayEndHour: Math.min(startHour + 8, 24)
  };
  await saveDefaults(next);
  success(`Saved schedule: ${startHour}:00 ${timezone}`);
  return next;
}

async function setupPolicy() {
  sectionTitle('Policy');
  await ensureServer();
  const config = await request('/api/gateway/policy/config');
  if (options.quick && config.policyProfileName) {
    success(`Policy profile is configured: ${config.policyProfileName}`);
    return;
  }
  const profiles = config.profiles || [];
  numberedList(profiles, (profile) => `${profile.name} - ${profile.description}`);
  const currentName = config.policyProfileName || 'default';
  const defaultIndex = Math.max(1, profiles.findIndex((profile) => profile.name === currentName) + 1);
  if (options.nonInteractive) {
    if (!config.policyProfileName) fail('Missing explicit policy profile. Run murph setup policy.');
    return;
  }
  const selected = profiles[await askIndex('Choose policy profile', profiles, defaultIndex)];
  await request('/api/gateway/policy/config', {
    method: 'PUT',
    body: JSON.stringify({ profileName: selected.name })
  });
  success(`Saved policy profile: ${selected.name}`);
}

async function setupStatus() {
  const localStatus = {
    configFile: existsSync(configPath),
    credentialsFile: existsSync(credentialsPath),
    aiProvider: Boolean(readSetupValue('OPENAI_API_KEY') || readSetupValue('ANTHROPIC_API_KEY')),
    defaultProvider: currentDefaultProvider(),
    defaultModel: currentDefaultModel(currentDefaultProvider()),
    agentProvider: currentAgentProvider(currentDefaultProvider()),
    agentModel: currentAgentModel(currentAgentProvider(currentDefaultProvider())),
    agentInheritsRuntime: !hasAgentOverride(),
    channelProvider: currentChannelProvider(),
    workspaceId: currentWorkspaceId(),
    slackConfig: Boolean(readSetupValue('SLACK_APP_TOKEN') && readSetupValue('SLACK_CLIENT_ID') && readSetupValue('SLACK_CLIENT_SECRET')),
    discordConfig: Boolean(readSetupValue('DISCORD_BOT_TOKEN') && readSetupValue('DISCORD_CLIENT_ID'))
  };
  let server = null;
  if (await health()) {
    server = {
      setup: await request('/api/setup/status'),
      doctor: await request('/api/setup/doctor'),
      defaults: await request('/api/setup/defaults')
    };
  }

  if (options.json) {
    console.log(JSON.stringify({ ok: true, local: localStatus, server }, null, 2));
    return;
  }

  sectionTitle('Setup status');
  statusGroup('Local files');
  statusLine('Config file', localStatus.configFile ? 'ok' : 'missing', localStatus.configFile ? configPath : 'missing');
  statusLine('Credentials file', localStatus.credentialsFile ? 'ok' : 'warning', localStatus.credentialsFile ? credentialsPath : 'will be created when a secret is saved');
  statusGroup('AI');
  statusLine('AI provider', localStatus.aiProvider ? 'ok' : 'missing', localStatus.aiProvider ? `${localStatus.defaultProvider}/${localStatus.defaultModel}` : 'missing');
  statusLine('Murph Agent model', localStatus.agentModel ? 'ok' : 'missing', localStatus.agentInheritsRuntime
    ? `inherits runtime (${localStatus.agentProvider}/${localStatus.agentModel})`
    : `${localStatus.agentProvider}/${localStatus.agentModel}`);
  statusGroup('Slack');
  statusLine('Slack app config', localStatus.slackConfig ? 'ok' : 'missing', localStatus.slackConfig ? 'configured' : 'missing');
  statusGroup('Discord');
  statusLine('Discord bot config', localStatus.discordConfig ? 'ok' : 'missing', localStatus.discordConfig ? 'configured' : 'missing');
  if (server) {
    statusGroup('Doctor');
    for (const check of server.doctor.checks) {
      statusLine(check.label, check.status === 'ok' ? 'ok' : check.status === 'warning' ? 'warning' : 'missing', check.message);
    }
  } else {
    warn(`Murph is not running at ${murphUrl}.`);
  }
}

async function runAll() {
  banner();
  await setupCore();
  await setupAi();
  const provider = await setupChannelProvider();
  if (provider === 'discord') {
    await setupDiscord();
  } else {
    await setupSlack();
  }
  await setupIdentity();
  await setupChannels();
  await setupSchedule();
  await setupPolicy();
  await setupStatus();
  console.log('');
  success('Murph setup is complete.');
  callout('Murph URL', murphUrl);
}

try {
  process.chdir(appDir);
  switch (section) {
    case 'all':
      await runAll();
      break;
    case 'core':
      await setupCore();
      break;
    case 'ai':
    case 'provider':
      await setupAi();
      break;
    case 'slack':
      await setupSlack();
      break;
    case 'discord':
      await setupDiscord();
      break;
    case 'identity':
      await setupIdentity();
      break;
    case 'channels':
      await setupChannels();
      break;
    case 'schedule':
      await setupSchedule();
      break;
    case 'policy':
      await setupPolicy();
      break;
    case 'status':
      await setupStatus();
      break;
    case 'help':
    case '-h':
    case '--help':
      usage();
      break;
    default:
      usage();
      process.exitCode = 1;
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  rl.close();
}
