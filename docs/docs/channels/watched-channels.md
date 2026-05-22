---
title: Watched Channels
description: Choose which channels Murph watches during sessions.
---

# Watched Channels

Murph only watches channels included in the active session scope.

## Selected channels

Selected channels are the safest default. Choose the specific channels Murph should cover during handoff sessions.

Use selected channels first when testing a new Slack workspace or Discord server. This keeps early runs limited to channels where you have already checked app access and policy behavior.

## All accessible channels

All accessible channels tells Murph to watch every channel the connected app can read.

Use this only after verifying the app or bot has the access you expect. For Slack, this includes channels the app can read or join. For Discord, this includes channels visible to the bot with the required server and channel permissions.

## Session scope

Setup saves default channel choices. A session uses those defaults when you start a bounded offline handoff.

Re-run channel setup when the default scope changes:

```bash
murph setup channels
```

You can choose comma-separated channel numbers from the setup list, or type `all` for all accessible channels.

## Private channels

Private channels require the channel app or bot to already have access. Murph cannot read private channels it has not been invited to.

## Membership

For public Slack channels, Murph can try to join before a session starts. Private Slack channels require an invitation.

For Discord, if channel listing is unavailable, setup can accept Discord channel IDs manually and validate each ID through the bot when it has access.
