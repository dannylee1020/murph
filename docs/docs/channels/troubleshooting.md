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

## Missing scopes

If Slack reports missing scopes, reinstall or reconnect the Slack app after updating the app configuration.

## Missing channels

If no channels load, reconnect Slack and verify the app is installed in the expected workspace.

## Private channels

Invite the app to private channels before selecting them. Murph cannot self-join private channels.

## Channel defaults

Run channel setup again when Murph has no saved default channel scope:

```bash
murph setup channels
```
