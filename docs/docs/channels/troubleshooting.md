---
title: Channel Troubleshooting
description: Fix channel setup and access issues.
---

# Channel Troubleshooting

Start with `murph doctor` when channel setup or runtime behavior fails.

## Health check

```bash
murph doctor
```

The doctor check reports missing app settings, missing credentials, disconnected workspaces, missing identity, and missing channel defaults.

## Reconnect required

Reconnect a channel when saved credentials are missing, stale, or created before the latest required scopes.

If Murph reports missing owner identity, reconnect the channel through OAuth. Slack and Discord owner identity comes from the authorizing account; Murph no longer lists workspace/server members or accepts a manual user ID.

## Missing scopes

If Slack reports missing scopes, reinstall or reconnect the Slack app after updating the app configuration.

Slack search requires the `search:read` user scope. Refresh it with:

```bash
murph setup slack --reconnect-search
```

## Missing channels

If no Slack channels load, reconnect Slack and verify the app is installed in the expected workspace.

If no Discord channels load, verify the bot is installed in the expected server and has channel-level access to View Channels, Send Messages, Read Message History, and Send Messages in Threads. If listing still fails, run:

```bash
murph setup channels
```

Then paste Discord channel IDs when prompted.

## Private channels

Invite the app to private channels before selecting them. Murph cannot self-join private channels.

## Channel defaults

Run channel setup again when Murph has no saved default channel scope:

```bash
murph setup channels
```

## OAuth callback mismatch

Slack and Discord callback URLs must match the local Murph origin exactly. The default callbacks are:

```text
http://localhost:5173/api/slack/oauth/callback
http://localhost:5173/api/discord/oauth/callback
```

If you change the local origin in `~/.murph/config.yaml`, update provider callback URLs before reconnecting. If you intentionally override the running process with `MURPH_PORT`, `MURPH_URL`, `MURPH_APP_URL`, or `DISCORD_REDIRECT_URI`, update those callback URLs to match the override.
