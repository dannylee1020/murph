#!/usr/bin/env node
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

const appDir = process.env.MURPH_APP_DIR || process.cwd();
const murphUrl = process.env.MURPH_URL || `http://localhost:${process.env.MURPH_PORT || '5173'}`;
const envPath = path.join(appDir, '.env');
const rl = readline.createInterface({ input, output });

const args = process.argv.slice(2);
const options = {
  quick: args.includes('--quick'),
  nonInteractive: args.includes('--non-interactive'),
  json: args.includes('--json')
};
const section = args.find((arg) => !arg.startsWith('--')) || 'all';
const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const color = {
  reset: useColor ? '\x1b[0m' : '',
  bold: useColor ? '\x1b[1m' : '',
  dim: useColor ? '\x1b[2m' : '',
  green: useColor ? '\x1b[32m' : '',
  yellow: useColor ? '\x1b[33m' : '',
  cyan: useColor ? '\x1b[36m' : '',
  red: useColor ? '\x1b[31m' : ''
};

function paint(style, text) {
  return `${color[style] || ''}${text}${color.reset}`;
}

function usage() {
  console.log(`Usage: murph setup [section] [options]

Sections:
  core        Create core .env values and data directory.
  ai          Configure OpenAI or Anthropic.
  slack       Configure Slack app credentials and OAuth install.
  identity    Pick the Slack user Murph watches for.
  channels    Pick watched Slack channels or all accessible channels.
  schedule    Save the default workday schedule.
  policy      Select the local policy profile.
  status      Show setup readiness.

Options:
  --quick            Skip sections that are already configured.
  --non-interactive  Do not prompt; report missing setup and exit nonzero.
  --json             JSON output for status.
`);
}

function sectionTitle(title) {
  if (!options.json) {
    console.log('');
    console.log(paint('cyan', '== ') + paint('bold', title) + paint('cyan', ' =='));
  }
}

function fail(message) {
  throw new Error(message);
}

function info(message) {
  console.log(`${paint('cyan', '->')} ${message}`);
}

function success(message) {
  console.log(`${paint('green', 'OK')} ${message}`);
}

function warn(message) {
  console.log(`${paint('yellow', '!!')} ${message}`);
}

async function ask(question, defaultValue = '') {
  if (options.nonInteractive) {
    return defaultValue;
  }
  const suffix = defaultValue ? ` [${defaultValue}]` : '';
  const answer = await rl.question(`${paint('bold', '?')} ${question}${paint('dim', suffix)}: `);
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
  console.log(paint('cyan', '========================================'));
  console.log(`${paint('bold', 'Murph setup')} ${paint('dim', 'CLI-first configuration')}`);
  console.log(paint('cyan', '========================================'));
}

function statusLine(label, state, detail = '') {
  const marker = state === 'ok'
    ? paint('green', 'OK')
    : state === 'warning'
      ? paint('yellow', '!!')
      : paint('red', '--');
  console.log(`${marker} ${label.padEnd(22)} ${detail}`);
}

function readEnvFile() {
  return existsSync(envPath) ? readFileSync(envPath, 'utf8') : '';
}

function readEnvValue(key) {
  const match = readEnvFile().match(new RegExp(`^\\s*(?:export\\s+)?${key}=([^\\n]*)`, 'm'));
  if (!match) return process.env[key] || '';
  return match[1].trim().replace(/^['"]|['"]$/g, '');
}

function serializeEnvValue(value) {
  return /[\s#"'\\]/.test(value) ? JSON.stringify(value) : value;
}

function writeEnvValues(values) {
  const existing = readEnvFile();
  const lines = existing ? existing.split(/\r?\n/) : [];
  const updated = [];

  for (const [key, rawValue] of Object.entries(values)) {
    const value = String(rawValue || '').trim();
    if (!value) continue;
    const line = `${key}=${serializeEnvValue(value)}`;
    const index = lines.findIndex((entry) => new RegExp(`^\\s*(?:export\\s+)?${key}=`).test(entry));
    if (index >= 0) {
      lines[index] = line;
    } else {
      if (lines.length > 0 && lines[lines.length - 1] !== '') lines.push('');
      lines.push(line);
    }
    process.env[key] = value;
    updated.push(key);
  }

  if (updated.length > 0) {
    writeFileSync(envPath, `${lines.join('\n').replace(/\n+$/, '')}\n`, { mode: 0o600 });
  }
  return updated;
}

function generateSecret() {
  return randomBytes(32).toString('hex');
}

function mask(value) {
  if (!value) return 'missing';
  if (value.length <= 8) return 'configured';
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
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
    fail(payload.error || `Request failed: ${pathname}`);
  }
  return payload;
}

async function health() {
  try {
    await request('/api/health');
    return true;
  } catch {
    return false;
  }
}

async function postSetupEnv(values) {
  if (!(await health())) return;
  await request('/api/setup/env', {
    method: 'POST',
    body: JSON.stringify(values)
  });
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

function openUrl(url) {
  if (!process.stdout.isTTY || options.nonInteractive) return;
  const opener = process.platform === 'darwin' ? 'open' : 'xdg-open';
  spawnSync(opener, [url], { stdio: 'ignore' });
}

async function setupCore() {
  sectionTitle('Core');
  mkdirSync(path.join(appDir, 'data'), { recursive: true });
  const values = {};
  if (!readEnvValue('MURPH_APP_URL')) values.MURPH_APP_URL = murphUrl;
  if (!readEnvValue('MURPH_SQLITE_PATH')) values.MURPH_SQLITE_PATH = 'data/murph.sqlite';
  if (!readEnvValue('MURPH_ENCRYPTION_KEY')) values.MURPH_ENCRYPTION_KEY = generateSecret();
  if (!readEnvValue('SLACK_EVENTS_MODE')) values.SLACK_EVENTS_MODE = 'socket';
  const updated = writeEnvValues(values);
  if (updated.length > 0) {
    success(`Updated .env: ${updated.join(', ')}`);
  } else {
    success('Core .env values are present.');
  }
}

async function setupAi() {
  sectionTitle('AI provider');
  const currentProvider = readEnvValue('MURPH_DEFAULT_PROVIDER') || 'openai';
  const hasKey = Boolean(readEnvValue('OPENAI_API_KEY') || readEnvValue('ANTHROPIC_API_KEY'));
  if (options.quick && hasKey) {
    success(`AI provider is configured (${currentProvider}).`);
    return;
  }
  if (options.nonInteractive && !hasKey) {
    fail('Missing AI provider key. Set OPENAI_API_KEY or ANTHROPIC_API_KEY, or run murph setup ai.');
  }

  const providerInput = await askChoice('Provider: [1] OpenAI  [2] Anthropic', ['1', '2', 'openai', 'anthropic'], currentProvider === 'anthropic' ? '2' : '1');
  const provider = providerInput === '2' || providerInput.toLowerCase() === 'anthropic' ? 'anthropic' : 'openai';
  const keyName = provider === 'anthropic' ? 'ANTHROPIC_API_KEY' : 'OPENAI_API_KEY';
  const existing = readEnvValue(keyName);
  const key = await askRequired(
    existing
      ? `${provider === 'anthropic' ? 'Anthropic' : 'OpenAI'} API key (leave blank to keep current)`
      : `${provider === 'anthropic' ? 'Anthropic' : 'OpenAI'} API key`,
    existing
  );
  const values = { MURPH_DEFAULT_PROVIDER: provider, [keyName]: key };
  writeEnvValues(values);
  await postSetupEnv(values);
  success(`Saved ${provider} key (${mask(key)}).`);
}

async function setupSlack() {
  sectionTitle('Slack');
  const configured = Boolean(readEnvValue('SLACK_APP_TOKEN') && readEnvValue('SLACK_CLIENT_ID') && readEnvValue('SLACK_CLIENT_SECRET'));
  if (!(options.quick && configured)) {
    if (options.nonInteractive && !configured) {
      fail('Missing Slack app settings. Set SLACK_APP_TOKEN, SLACK_CLIENT_ID, and SLACK_CLIENT_SECRET.');
    }
    info('Use docs/public/slack-socket-mode-manifest.yml and this redirect URL:');
    console.log(`   ${paint('bold', `${murphUrl}/api/slack/oauth/callback`)}`);
    const values = {
      SLACK_EVENTS_MODE: 'socket',
      SLACK_APP_TOKEN: await askRequired('Slack app-level token (xapp-...)', readEnvValue('SLACK_APP_TOKEN')),
      SLACK_CLIENT_ID: await askRequired('Slack client ID', readEnvValue('SLACK_CLIENT_ID')),
      SLACK_CLIENT_SECRET: await askRequired('Slack client secret', readEnvValue('SLACK_CLIENT_SECRET'))
    };
    writeEnvValues(values);
    await postSetupEnv(values);
  }

  await ensureServer();
  let status = await request('/api/setup/status');
  if (status.slack?.installed) {
    success('Slack workspace is connected.');
    return;
  }

  const installUrl = `${murphUrl}/api/slack/install`;
  info('Open Slack OAuth:');
  console.log(`   ${paint('bold', installUrl)}`);
  openUrl(installUrl);
  if (options.nonInteractive) {
    fail('Slack OAuth is not complete.');
  }
  await rl.question('Press Enter after Slack OAuth finishes.');
  for (let i = 0; i < 20; i += 1) {
    status = await request('/api/setup/status');
    if (status.slack?.installed) {
      success('Slack workspace connected.');
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  fail('Slack OAuth did not complete yet. Re-run: murph setup slack');
}

async function getDefaults() {
  await ensureServer();
  return request('/api/setup/defaults');
}

async function saveDefaults(defaults) {
  await ensureServer();
  return request('/api/setup/defaults', {
    method: 'PUT',
    body: JSON.stringify(defaults)
  });
}

function numberedList(items, formatter) {
  items.forEach((item, index) => {
    console.log(`  ${paint('cyan', String(index + 1).padStart(2, ' '))}. ${formatter(item)}`);
  });
}

async function setupIdentity() {
  sectionTitle('Identity');
  const current = await getDefaults();
  if (options.quick && current.defaults?.ownerUserId) {
    success(`Owner is configured: ${current.defaults.ownerDisplayName || current.defaults.ownerUserId}`);
    return current.defaults;
  }
  if (options.nonInteractive && !current.defaults?.ownerUserId) {
    fail('Missing owner identity. Run murph setup identity.');
  }

  const members = await request('/api/slack/members');
  if (!members.members?.length) {
    const name = await askRequired('Display name');
    const id = name.toLowerCase().replace(/\s+/g, '_');
    return (await saveDefaults({ ...current.defaults, ownerUserId: id, ownerDisplayName: name })).defaults;
  }

  info('Choose the Slack user Murph should watch for.');
  numberedList(members.members, (member) => member.displayName);
  const defaultIndex = Math.max(1, members.members.findIndex((member) => member.id === current.defaults?.ownerUserId) + 1);
  const selectedMember = members.members[await askIndex('Choose yourself', members.members, defaultIndex || 1)];
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

  const payload = await request('/api/slack/channels');
  const channels = payload.channels || [];
  if (channels.length === 0) {
    const next = { ...current.defaults, channelScopeMode: 'all_accessible', selectedChannels: [] };
    await saveDefaults(next);
    console.log('No channels returned. Saved all accessible channels.');
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
  const envStatus = {
    envFile: existsSync(envPath),
    encryptionKey: Boolean(readEnvValue('MURPH_ENCRYPTION_KEY')),
    aiProvider: Boolean(readEnvValue('OPENAI_API_KEY') || readEnvValue('ANTHROPIC_API_KEY')),
    slackConfig: Boolean(readEnvValue('SLACK_APP_TOKEN') && readEnvValue('SLACK_CLIENT_ID') && readEnvValue('SLACK_CLIENT_SECRET'))
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
    console.log(JSON.stringify({ ok: true, env: envStatus, server }, null, 2));
    return;
  }

  sectionTitle('Setup status');
  statusLine('.env', envStatus.envFile ? 'ok' : 'missing', envStatus.envFile ? 'present' : 'missing');
  statusLine('Encryption key', envStatus.encryptionKey ? 'ok' : 'missing', envStatus.encryptionKey ? 'configured' : 'missing');
  statusLine('AI provider', envStatus.aiProvider ? 'ok' : 'missing', envStatus.aiProvider ? 'configured' : 'missing');
  statusLine('Slack app config', envStatus.slackConfig ? 'ok' : 'missing', envStatus.slackConfig ? 'configured' : 'missing');
  if (server) {
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
  await setupSlack();
  await setupIdentity();
  await setupChannels();
  await setupSchedule();
  await setupPolicy();
  await setupStatus();
  console.log('');
  success('Murph setup is complete.');
  console.log(`   ${paint('bold', murphUrl)}`);
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
      await setupAi();
      break;
    case 'slack':
      await setupSlack();
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
