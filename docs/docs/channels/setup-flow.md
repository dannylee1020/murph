---
title: Setup Flow
description: Connect messaging channels to Murph.
---

# Setup Flow

Channel setup connects a messaging workspace and saves the local defaults Murph needs for handoff sessions.

## CLI setup

Run the full setup wizard:

```bash
murph setup
```

The full wizard runs these sections:

```text
core -> provider -> channel provider -> slack/discord -> identity -> channels -> schedule -> policy -> status
```

Run channel-specific setup when only channel settings changed:

```bash
murph setup slack
murph setup discord
murph setup channels
```

Slack setup is mostly automated through the Slack manifest and OAuth flow. Discord setup requires a few manual Developer Portal steps first: create the bot, copy the bot token and client secret, add the exact OAuth redirect URI, and enable Message Content intent. Use [Discord](/docs/channels/discord) for the step-by-step checklist.

## Browser setup

Start Murph and open the local UI:

```bash
murph start
murph open
```

Use the setup wizard to connect Slack or Discord, authorize your own account through OAuth, and choose watched channels. Owner identity is captured from the OAuth callback; Murph does not list workspace members or let you choose another user.

## Local storage

Secrets are stored in `~/.murph/.credentials`. Non-secret app and workspace metadata is stored in `~/.murph/config.yaml`.

Channel defaults include:

- the selected channel provider
- the connected Slack workspace or Discord server
- the OAuth owner identity for that workspace/server
- selected channels or all accessible channels

If identity is missing, reconnect Slack or Discord. `murph setup identity` verifies identity, but it cannot manually set a different owner.

## Setup check

Run a health check after channel setup:

```bash
murph doctor
```
