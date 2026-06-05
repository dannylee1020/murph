---
title: Channels
description: Connect messenger channels that Murph can cover during sessions.
---

# Channels

Channels are messenger surfaces that Murph can cover during bounded async coverage sessions. Murph covers selected team channels from one runtime host. Runtime storage, SQLite, memory, config, credentials, policy, review, and plugin code stay on the machine hosting that runtime.

## Built-in channels

- Slack
- Discord

These are the built-in messenger channels Murph ships with today.

## Additional channels

Additional messaging providers use the advanced [channel plugin](/docs/plugins/channels) path. A channel plugin keeps provider-specific runtime code out of Murph core, but it does not remove provider setup work.

For implementation details, use [Extending Channels](/docs/developing/extending/channels).

Expect custom channel setup to involve manual steps in the provider's console, such as creating an app or bot, choosing scopes, approving workspace/server access, and configuring webhooks or realtime transport.

Murph Agent can scaffold a channel plugin and guide the setup, but arbitrary channel plugins are not the same as built-in channel support. Official setup recipes for more providers will be added over time.

## Setup flow

Use [Setup Flow](/docs/channels/setup-flow) to connect bots and save local defaults.

## Watched channels

Use [Watched Channels](/docs/channels/watched-channels) to decide whether Murph watches selected channels or all accessible channels.

## Slack

Use [Slack](/docs/channels/slack) for Socket Mode setup, OAuth, channel membership, and reconnect notes.

## Discord

Use [Discord](/docs/channels/discord) for Discord bot setup and current runtime expectations.

## Troubleshooting

Use [Troubleshooting](/docs/channels/troubleshooting) when setup checks, reconnects, scopes, or channel access fail.
