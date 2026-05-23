---
title: Extending Channels
description: Add messaging providers with channel plugins.
---

# Extending Channels

Channel plugins add Slack- or Discord-style messaging providers without editing Murph core runtime files.

Use a channel plugin when Murph must receive provider events, fetch thread context, and post replies.

## Manifest

```json
{
  "id": "teams",
  "name": "Microsoft Teams",
  "description": "Teams channel plugin",
  "version": "0.1.0",
  "capabilities": {
    "channels": ["channel.mjs"]
  }
}
```

The channel id must match the manifest id.

## Channel export

`channel.mjs` must export `channel` or a default descriptor:

```js
export const channel = {
  id: 'teams',
  displayName: 'Microsoft Teams',
  description: 'Microsoft Teams messaging provider.',
  runtime,
  setup,
  ingress
};
```

## Runtime adapter

The runtime adapter normalizes provider events and performs message operations:

```js
export const runtime = {
  id: 'teams',
  displayName: 'Microsoft Teams',
  capabilities: ['event_ingress', 'thread_fetch', 'reply_post'],
  normalizeEvent(event, envelope) {
    return buildTeamsTask(event, envelope);
  },
  async fetchThread(workspace, thread) {
    return await fetchTeamsThread(workspace, thread);
  },
  async postReply(workspace, thread, text) {
    await postTeamsReply(workspace, thread, text);
  }
};
```

Required runtime methods:

- `normalizeEvent`
- `fetchThread`
- `postReply`

`normalizeEvent` returns a `ContinuityTask | null`. The task should include a stable id, workspace id, target user id, provider-specific `thread`, trigger message, raw event id, dedupe key, and received timestamp. Set `thread.provider` to the channel id so downstream runtime code can route thread operations back to the plugin.

Optional methods:

- `postMessage`
- `checkMembership`
- `ensureMember`

## Setup hooks

Use `setup` when the provider needs status checks, channel/member lists, OAuth callbacks, or setup actions:

```js
export const setup = {
  requirements: [
    {
      key: 'TEAMS_BOT_TOKEN',
      label: 'Bot token',
      kind: 'secret',
      required: true
    }
  ],
  async getStatus() {
    return { configured: Boolean(process.env.TEAMS_BOT_TOKEN) };
  },
  async listChannels(workspace) {
    return await listTeamsChannels(workspace);
  }
};
```

Murph exposes provider-neutral setup endpoints:

```text
GET  /api/channels/providers
GET  /api/channels/:provider/setup/status
GET  /api/channels/:provider/members
GET  /api/channels/:provider/channels
POST /api/channels/:provider/setup/:action
GET  /api/channels/:provider/oauth/callback
POST /api/channels/:provider/events
```

## Ingress

Use `ingress.start` for realtime connections. Use `ingress.handleWebhook` for provider webhooks.

Provider-console work remains outside Murph when the provider requires it: creating apps, approving scopes, registering redirect URLs, configuring webhooks, enabling socket or gateway access, and completing provider review.
