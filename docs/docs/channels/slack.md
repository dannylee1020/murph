---
title: Slack
description: Connect Slack as a Murph channel.
---

# Slack

Slack is the most complete Murph channel setup path today.

## Setup command

Run Slack setup from the CLI:

```bash
murph setup slack
```

You can also choose Slack during the full setup flow:

```bash
murph setup
```

Slack secrets are stored locally in `~/.murph/.credentials`. Non-secret app and workspace defaults are stored in `~/.murph/config.yaml`.

## Before you start

You need permission to create and install Slack apps in the target workspace.

The installer includes setup helpers such as the Slack CLI when needed, but Murph can still fall back to manual Slack app setup.

## Manual Slack checklist

The preferred path is to let Murph create the Slack app from the manifest:

1. Open Slack's app configuration token flow in your browser.
2. Create an app configuration token for the workspace you want Murph to use.
3. Run `murph setup slack`.
4. Paste the app configuration token when setup asks for it.
5. Create or copy the Slack app-level token when setup asks for it.
6. Open the Murph-generated Slack install URL and approve the workspace install.

Murph uses the app configuration token once to create the app from the manifest, then discards it.

If app automation fails or you choose manual setup:

1. Create a Slack app from the manifest at `docs/public/slack-manifest.yaml`.
2. Confirm the redirect URL printed by setup is listed in the Slack app.
3. Confirm Socket Mode is enabled.
4. Create an app-level token that starts with `xapp-` and includes `connections:write`.
5. Copy the Client ID, Client Secret, and app-level token into setup.
6. Copy the Signing Secret when you want HTTP event signature verification configured.
7. Open the Murph-generated install URL and approve OAuth.

The public manifest path is also available after install:

```text
/slack-manifest.yaml
```

## OAuth redirect

For local setup, the redirect URL is usually:

```text
http://localhost:5173/api/slack/oauth/callback
```

If `MURPH_APP_URL` points to a public tunnel or hosted URL, use that origin with `/api/slack/oauth/callback`.

## Socket Mode and tokens

Murph uses Slack Socket Mode by default. Socket Mode avoids exposing a public Events URL during local development.

Slack setup needs these app credentials:

- Client ID
- Client Secret
- app-level token (`xapp-...`) with `connections:write`
- Signing Secret when HTTP event signature verification is needed

After OAuth approval, Murph stores the workspace bot token locally. If the user-search scopes are approved, Murph also stores a user search token locally.

## OAuth scopes

Murph's manifest requests bot scopes for messages, channel listing, channel joins, replies, direct messages, and user lookup.

It also requests user scopes for Slack search:

- `search:read.public`
- `search:read.private`
- `search:read.im`
- `search:read.mpim`

Reconnect Slack after adding scopes or changing user-search consent:

```bash
murph setup slack --reconnect-search
```

Reconnect stores a fresh user-search token locally.

## What setup automates

`murph setup slack` handles the Murph side of the flow:

- detects authorized Slack CLI workspaces when available
- creates the app from `docs/public/slack-manifest.yaml` when given an app configuration token
- saves Slack app credentials locally
- starts or verifies the local Murph server
- opens the Slack install URL
- saves the connected workspace after OAuth
- stores bot and user-search tokens from the OAuth callback
- starts Socket Mode when the workspace is connected

## Identity and channels

After Slack is connected, setup asks for:

- the Slack user Murph should watch for
- the Slack channels Murph should monitor

Public channels can be joined automatically when Slack permissions allow it. Private channels must already include the Slack app.

Use channel-specific setup when only watched channels changed:

```bash
murph setup channels
```

## Troubleshooting

If Slack reports a redirect URI mismatch, add the exact redirect URL printed by setup to the Slack app's OAuth settings.

If setup says the app configuration token looks like an app-level token, create a Slack app configuration token instead. App-level tokens start with `xapp-` and are used for Socket Mode, not app creation.

If Slack channels do not load, reconnect Slack and verify the app is installed in the expected workspace.

If selected public channels cannot be joined, reinstall or reconnect Slack after updating scopes. Private channels require inviting the Slack app directly.

## Runtime path

Each Slack handoff follows the same path:

```text
Slack channel -> context -> grounded draft -> policy -> send | queue | skip
```
