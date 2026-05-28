---
title: Setup Flow
description: Connect messaging channels to Murph.
---

# Setup Flow

Channel setup connects messaging bots and saves the local defaults Murph needs for personal DM coverage and shared-channel async-work sessions.

Murph does not require a single runtime mode anymore. The same runtime can run:

- a personal bot for explicit DMs to the represented owner's Murph bot;
- a channel bot for shared-channel coverage during active sessions;
- both bot roles side by side.

Use separate provider app identities when you enable both roles. The host machine still owns the runtime bundle: credentials, config, SQLite OLTP data, generated memory, integrations, policy, review, plugins, and the operator UI all stay with the runtime.

## CLI setup

Run the full setup wizard:

```bash
murph setup
```

The full wizard runs these sections:

```text
core -> provider -> coverage -> bot app setup -> owner OAuth -> channels -> schedule -> policy -> status
```

Run channel-specific setup when only channel settings changed:

```bash
murph setup roles
murph setup providers
murph setup slack --role channel
murph setup slack --role personal
murph setup discord --role channel
murph setup discord --role personal
murph setup channels
```

Use `--role both` to configure both personal and channel app identities for one provider. Watched-channel selection only runs when the channel role is enabled.

Slack setup is mostly automated through the Slack manifest and OAuth flow. The personal Slack manifest enables the App Home Messages tab so people can DM the Murph Personal bot; if you configure Slack manually, turn that tab on yourself. Discord setup requires a few manual Developer Portal steps first: create the bot, copy the bot token and client secret, add the exact OAuth redirect URI, and enable Message Content intent. Use [Discord](/docs/channels/discord) for the step-by-step checklist.

## Browser setup

Start Murph and open the local UI:

```bash
murph start
murph open
```

Use the setup wizard to choose coverage in one step: Slack channel bot, Slack personal bot, Discord channel bot, Discord personal bot, or any combination of those identities. Each provider step shows app value state, bot install state, owner identity state, direct provider shortcuts, and the exact callback or redirect URI for the current Murph host. The wizard authorizes your own account through OAuth and only asks for watched channels when a channel bot is enabled. Owner identity is captured from the OAuth callback; Murph does not list workspace members or let you choose another user.

Role-specific HTTP install and event endpoints are available for hosted setups:

```text
/api/slack/channel/install
/api/slack/personal/install
/api/slack/channel/events
/api/slack/personal/events
/api/discord/channel/install
/api/discord/personal/install
```

The unqualified Slack and Discord install URLs remain compatibility aliases for channel-bot setup. Setup links include a source marker so OAuth returns to the right surface: CLI setup uses `source=cli` and ends on a browser page that tells you to return to the terminal, while the browser setup wizard uses `source=setup` and returns to `/setup`.

## Local storage

Secrets are stored in `~/.murph/.credentials`. Non-secret app and workspace metadata is stored in `~/.murph/config.yaml`.

Channel defaults include:

- the selected channel provider
- the connected Slack workspace or Discord server
- the OAuth owner identity for that workspace/server
- selected channels or all accessible channels

Personal-bot installs also record the represented owner on the bot installation, so explicit DMs to that bot can route to the right owner. Channel-bot installs use `workspace_subscriptions` and watched-channel defaults to decide which subscribed user can be routed from a shared-channel event.

If identity is missing, reconnect Slack or Discord. `murph setup identity` verifies identity, but it cannot manually set a different owner.

## Setup check

Run a health check after channel setup:

```bash
murph doctor
```
