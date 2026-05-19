---
title: Discord
description: Connect Discord as a Murph channel.
---

# Discord

Discord uses the same channel-adapter model as Slack: Murph watches selected channels, gathers context, drafts replies, applies policy, and keeps a review trail.

## Setup command

Configure Discord through the guided setup:

```bash
murph setup discord
```

You can also choose Discord during the full setup flow:

```bash
murph setup
```

Discord bot secrets are stored locally in `~/.murph/.credentials`.

## Before you start

You need access to the Discord Developer Portal and permission to add a bot to the target server.

No separate Discord API key is needed. Murph uses the Discord bot token for REST and gateway calls.

## Manual Discord checklist

Create the Discord app and bot first:

1. Open the [Discord Developer Portal](https://discord.com/developers/applications).
2. Create an application for Murph, or open an existing one.
3. Go to **Bot**.
4. Add a bot if the application does not already have one.
5. Generate or reset the bot token.
6. Keep the token ready for `murph setup discord`.

Enable privileged intents when needed:

- **Server Members Intent** lets Murph fetch server members for the owner picker.
- **Message Content Intent** lets Murph read Discord message text at runtime.

Murph tries to enable the limited intent flags automatically through Discord's application API. If Discord rejects that update, enable both intents manually on the Bot page.

Install or re-approve the bot:

1. Run `murph setup discord`.
2. Paste the bot token when prompted.
3. Open the Discord install URL printed by Murph.
4. Choose the server Murph should use.
5. Approve the requested permissions.

If the bot was installed before Murph configured permissions, open the install URL again and approve the updated permissions.

## Bot permissions

Murph requests this scoped permission set:


- View Channels
- Send Messages
- Embed Links
- Read Message History
- Send Messages in Threads

Do not grant Administrator unless you explicitly want to. Murph only needs access to the channels it should watch and reply in.

## What setup automates

`murph setup discord` handles the Murph side of the flow:

- validates the bot token
- detects the application/client ID
- stores the bot token in `~/.murph/.credentials`
- generates the Discord install URL
- tries to configure default install permissions
- tries to configure limited privileged intent flags
- discovers servers where the bot is installed
- validates pasted server, user, and channel IDs when automatic discovery is blocked

Non-secret setup defaults are stored in `~/.murph/config.yaml`.

## Identity and channels

After the bot is connected, setup asks for:

- the Discord server Murph should use
- the Discord user Murph should watch for
- the Discord channels Murph should monitor

If automatic discovery fails, setup falls back to manual IDs:

- paste the Discord server ID when server discovery fails
- paste your Discord user ID when member listing fails
- paste Discord channel IDs when channel listing fails

Murph validates pasted IDs through Discord before saving them when Discord allows the lookup.

## Gateway behavior

Murph receives Discord messages through the Discord gateway client when the runtime starts.

## Session scope

Murph only acts in selected Discord channels for an active handoff session.

## Troubleshooting

`Failed to fetch Discord members` usually means Server Members Intent is not enabled, or Discord has not accepted the app configuration update yet. Enable Server Members Intent in the Developer Portal, then rerun `murph setup identity`.

`Failed to fetch Discord channels` or `Missing Access` usually means the bot lacks View Channels in the selected server or channel. Re-open the install URL and approve the requested permissions, or paste channel IDs when setup asks for them.

If Murph cannot detect the installed server, paste the Discord server ID. The bot still has to be installed in that server.

If permissions or intents changed after the bot was installed, the server admin must re-open the install URL and approve the updated permissions.

## Current status

Slack is the most complete setup path today. Verify Discord channel behavior with `murph doctor` and a short test session before relying on it for production handoffs.
