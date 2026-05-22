---
title: Channel Plugins
description: Add messaging providers without editing Murph core runtime code.
---

# Channel Plugins

Channel plugins are an advanced extension path for Slack/Discord-style messaging providers.

Murph ships with Slack and Discord as built-in channels. Other providers can be added locally as channel plugins, but they are not turnkey built-in support.

Channel plugins solve the Murph-side boundary: provider-specific runtime code, setup metadata, and ingress behavior can live outside core source. They do not remove the provider-side setup work required by each platform.

Ask `murph agent` to build plugins for you or use a category-first package:

```text
~/.murph/plugins/channels/<id>
```

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

## Channel export

`channel.mjs` must export `channel` or a default descriptor:

```js
export const channel = {
  id: 'teams',
  displayName: 'Microsoft Teams',
  runtime,
  setup,
  ingress
};
```

The descriptor has three parts:

- `runtime`: normalize events, fetch thread messages, post replies, and optionally post top-level messages or check membership.
- `setup`: setup/status behavior, member lookup, channel lookup, setup actions, and OAuth callbacks when the provider needs them.
- `ingress`: webhook or realtime startup behavior.

## Runtime boundary

Custom channels should not change Murph core runtime files. Core discovers the package, validates the channel descriptor, registers it, exposes setup APIs, starts ingress, and hands normalized tasks to the gateway.

Built-in Slack and Discord use the same contract as custom channel plugins.

## Setup responsibility

Murph Agent can scaffold a channel plugin, explain setup steps, reload the plugin, and call Murph's validation APIs.

The user still owns provider-console steps that Murph cannot safely automate:

- creating the provider app, bot, or integration;
- approving scopes, permissions, intents, or workspace/server access;
- copying secrets into local setup;
- configuring redirect URLs, webhooks, socket mode, or gateway access;
- completing provider review or approval when the provider requires it.

For popular providers, official Murph Agent setup recipes can make this guided. Until a provider has an official recipe, treat its channel plugin as a local advanced integration.

## Generic APIs

Murph exposes provider-neutral channel setup and ingress endpoints:

```text
GET  /api/channels/providers
GET  /api/channels/:provider/setup/status
GET  /api/channels/:provider/members
GET  /api/channels/:provider/channels
POST /api/channels/:provider/setup/:action
GET  /api/channels/:provider/oauth/callback
POST /api/channels/:provider/events
```

Existing Slack and Discord compatibility endpoints remain available. Custom channel plugins should target the generic channel APIs.
