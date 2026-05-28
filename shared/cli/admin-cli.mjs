#!/usr/bin/env node
const murphUrl = (process.env.MURPH_URL || `http://localhost:${process.env.MURPH_PORT || '5173'}`).replace(/\/+$/, '');

function usage() {
  console.log(`Usage: murph admin <command>

Commands:
  url                                Print the admin dashboard URL.
  subscribers [options]              List subscriber dashboard access.
  subscribers link <userId> [options]    Create or regenerate a subscriber dashboard link.
  subscribers revoke <userId> [options]  Revoke a subscriber dashboard link.

Options:
  --workspace-id <id>                Scope subscriber commands to a workspace.
  --status <active|paused>           Filter subscriber list by status.
  --json                             Print machine-readable JSON.`);
}

function adminUrl() {
  const url = new URL('/admin', murphUrl);
  return url.toString();
}

function parseOptions(args) {
  const options = { json: false };
  const rest = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--json') {
      options.json = true;
    } else if (arg === '--workspace-id') {
      const value = args[index + 1];
      if (!value) throw new Error('--workspace-id requires a value');
      options.workspaceId = value;
      index += 1;
    } else if (arg === '--status') {
      const value = args[index + 1];
      if (value !== 'active' && value !== 'paused') {
        throw new Error('--status must be active or paused');
      }
      options.status = value;
      index += 1;
    } else {
      rest.push(arg);
    }
  }
  return { options, rest };
}

function subscriptionUrl(userId, options) {
  const path = userId
    ? `/api/gateway/subscriptions/${encodeURIComponent(userId)}/dashboard-link`
    : '/api/gateway/subscriptions';
  const url = new URL(path, murphUrl);
  if (options.workspaceId) url.searchParams.set('workspaceId', options.workspaceId);
  if (options.status && !userId) url.searchParams.set('status', options.status);
  return url.toString();
}

async function requestJson(url, method = 'GET') {
  const response = await fetch(url, {
    method
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || `Request failed: ${response.status}`);
  }
  return payload;
}

function formatScope(subscription) {
  return subscription.channelScopeMode === 'all_accessible'
    ? 'all accessible'
    : `${Array.isArray(subscription.channelScope) ? subscription.channelScope.length : 0} selected`;
}

function printSubscribers(payload, options) {
  if (options.json) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  const subscriptions = Array.isArray(payload.subscriptions) ? payload.subscriptions : [];
  if (subscriptions.length === 0) {
    console.log('No subscribers found.');
    return;
  }

  for (const subscription of subscriptions) {
    const access = subscription.dashboardAccessEnabled ? 'dashboard enabled' : 'no dashboard link';
    const policy = [
      subscription.policyProfileName || 'host default',
      subscription.policyMode || 'host mode'
    ].join(' / ');
    console.log(`${subscription.externalUserId}\t${subscription.displayName || '-'}\t${subscription.status}\t${access}\t${policy}\t${formatScope(subscription)}`);
  }
}

function printLink(payload, options) {
  if (options.json) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }
  console.log(payload.url);
}

function printRevoked(payload, userId, options) {
  if (options.json) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }
  console.log(`Revoked subscriber dashboard access for ${userId}.`);
}

async function subscribersCommand(args) {
  const subcommand = args[0] === 'link' || args[0] === 'revoke' ? args[0] : 'list';
  const optionArgs = subcommand === 'list' ? args : args.slice(2);
  const { options, rest } = parseOptions(optionArgs);

  if (subcommand === 'list') {
    if (rest.length > 0) throw new Error(`Unknown subscribers option: ${rest[0]}`);
    printSubscribers(await requestJson(subscriptionUrl(undefined, options)), options);
    return;
  }

  const userId = args[1];
  if (!userId || userId.startsWith('-')) {
    throw new Error(`murph admin subscribers ${subcommand} requires a userId`);
  }
  if (rest.length > 0) throw new Error(`Unknown subscribers option: ${rest[0]}`);

  if (subcommand === 'link') {
    printLink(await requestJson(subscriptionUrl(userId, options), 'POST'), options);
  } else {
    printRevoked(await requestJson(subscriptionUrl(userId, options), 'DELETE'), userId, options);
  }
}

async function main() {
  const command = process.argv[2] || 'help';
  try {
    if (command === 'url') {
      console.log(adminUrl());
    } else if (command === 'subscribers') {
      await subscribersCommand(process.argv.slice(3));
    } else {
      usage();
      process.exit(command === 'help' || command === '--help' || command === '-h' ? 0 : 1);
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

await main();
