---
title: Channels
description: Connect messaging surfaces that Murph can watch.
---

# Channels

Channels are messaging surfaces that Murph can watch during a bounded handoff session.

## Built-in channels

- Slack
- Discord

Slack and Discord are the channels Murph ships with today.

## Additional channels

Additional messaging providers use the advanced [channel plugin](/docs/plugins/channels) path. A channel plugin keeps provider-specific runtime code out of Murph core, but it does not remove provider setup work.

Expect custom channel setup to involve manual steps in the provider's console, such as creating an app or bot, choosing scopes, approving workspace/server access, and configuring webhooks or realtime transport.

Murph Agent can scaffold a channel plugin and guide the setup, but arbitrary channel plugins are not the same as built-in channel support. Official setup recipes for more providers will be added over time.

## Setup flow

Use [Setup Flow](/docs/channels/setup-flow) to connect a channel and save local defaults.

## Watched channels

Use [Watched Channels](/docs/channels/watched-channels) to decide whether Murph watches selected channels or all accessible channels.

## Slack

Use [Slack](/docs/channels/slack) for Socket Mode setup, OAuth, channel membership, and reconnect notes.

## Discord

Use [Discord](/docs/channels/discord) for Discord bot setup and current runtime expectations.

## Troubleshooting

Use [Troubleshooting](/docs/channels/troubleshooting) when setup checks, reconnects, scopes, or channel access fail.
