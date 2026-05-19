---
title: Discord
description: Connect Discord as a Murph channel.
---

# Discord

Discord uses the same channel-adapter model as Slack: Murph watches selected channels, gathers context, drafts replies, applies policy, and keeps a review trail.

## Setup command

Configure Discord through setup:

```bash
murph setup
```

Discord bot secrets are stored in `~/.murph/.credentials`.

## Bot credentials

Discord setup needs bot and OAuth credentials before Murph can connect to a server.

## Gateway behavior

Murph receives Discord messages through the Discord gateway client when the runtime starts.

## Session scope

Murph only acts in selected Discord channels for an active handoff session.

## Current status

Slack is the most complete setup path today. Verify Discord channel behavior with `murph doctor` and a short test session before relying on it for production handoffs.
