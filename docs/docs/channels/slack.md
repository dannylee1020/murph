---
title: Slack
description: Connect Slack as a Murph channel.
---

# Slack

Slack setup can create the Murph Slack app from a manifest, or you can configure the app manually in Slack's dashboard. Do the Slack dashboard steps first when manual setup is needed, then run `murph setup slack` to validate credentials, open OAuth, save your workspace, and choose watched channels.

For both personal and channel behavior in one runtime, create two Slack apps: one personal bot for DMs and one channel bot for watched-channel handoff. Use `/api/slack/personal/install`, `/api/slack/personal/events`, and `SLACK_PERSONAL_*` variables for the personal app. Use `/api/slack/channel/install`, `/api/slack/channel/events`, and `SLACK_CHANNEL_*` variables for the channel app. The unqualified `/api/slack/*` endpoints and legacy `SLACK_*` variables remain compatibility aliases for the channel bot.

## What You Need

- Access to the [Slack apps dashboard](https://api.slack.com/apps).
- Permission to create, configure, and install Slack apps in the target workspace.
- Murph running on the same local URL you will register as the OAuth redirect URL. The default is:

```text
http://localhost:5173/api/slack/oauth/callback
```

If `app.url` in `~/.murph/config.yaml` points to a public tunnel or hosted URL, register that origin with `/api/slack/oauth/callback`.

## Step 1: Create Or Open The Slack App

1. Open the [Slack apps dashboard](https://api.slack.com/apps).
2. Create a new app for Murph, or open the existing Murph app.
3. Keep the app page open. You will use **Basic Information**, **OAuth & Permissions**, **Socket Mode**, and **Event Subscriptions**.

The fastest path is to create the app from Murph's manifest. Slack's manifest flow is available from the [Create New App](https://api.slack.com/apps?new_app=1) page.

## Step 2: Create From The Murph Manifest

Use Murph's Slack manifest when Slack lets you create or update the app from a manifest:

```text
docs/public/slack-manifest.yaml
```

The public manifest is also available after install:

```text
/slack-manifest.yaml
```

The manifest sets the Murph app name, bot user, OAuth redirect URL, scopes, event subscriptions, and Socket Mode.

`murph setup slack` can also create or update the app from the manifest when you provide a Slack app configuration token. Murph uses that app configuration token once, then discards it.

Do not confuse the app configuration token with the app-level token. The app-level token starts with `xapp-` and is used for Socket Mode.

## Step 3: Add The OAuth Redirect URL

In **OAuth & Permissions** -> **Redirect URLs**, add the exact Murph callback URL:

```text
http://localhost:5173/api/slack/oauth/callback
```

Save the Slack app after adding it.

Slack requires redirect URLs to match exactly. If setup prints a different URL because you use a custom Murph origin, add that exact URL instead.

## Step 4: Check Scopes And Events

In **OAuth & Permissions** -> **Scopes**, verify these bot token scopes:

- `app_mentions:read`
- `channels:history`
- `channels:join`
- `channels:read`
- `chat:write`
- `groups:history`
- `groups:read`
- `im:history`
- `mpim:history`

Verify this user token scope:

- `search:read`

In **Event Subscriptions** -> **Subscribe to bot events**, verify these events:

- `app_mention`
- `message.channels`
- `message.groups`
- `message.im`
- `message.mpim`

Socket Mode means local Murph installs do not need a public Slack Events Request URL.

## Step 5: Enable Socket Mode And Create The App-Level Token

1. Go to **Socket Mode**.
2. Enable Socket Mode.
3. Go to **Basic Information** -> **App-Level Tokens**.
4. Create an app-level token with the `connections:write` scope.
5. Keep the generated `xapp-...` token ready for `murph setup slack`.

Murph uses this token to connect to Slack Socket Mode.

## Step 6: Copy The App Credentials

Go to **Basic Information** -> **App Credentials** and keep these values ready for setup:

- Client ID
- Client Secret
- Signing Secret

Murph stores the Client Secret and Signing Secret locally in `~/.murph/.credentials`. Non-secret app and workspace defaults are stored in `~/.murph/config.yaml`.

## Step 7: Run Slack Setup

Run:

```bash
murph setup slack
```

To configure one role explicitly:

```bash
murph setup slack --role channel
murph setup slack --role personal
```

You can also choose Slack during the full setup flow:

```bash
murph setup
```

Setup may ask for:

1. Slack app configuration token, if you want Murph to create or update the app from the manifest.
2. Slack app-level token (`xapp-...`) for Socket Mode.
3. Slack Client ID.
4. Slack Client Secret.
5. Slack Signing Secret.

Then Murph will:

- save Slack app credentials locally;
- start or verify the local Murph server;
- open the Slack install URL;
- save the connected workspace after OAuth;
- store bot and user-search tokens from the OAuth callback;
- save the authorizing Slack user as Murph's owner identity;
- start Socket Mode when the workspace is connected.

## Step 8: Approve OAuth And Choose Channels

When the browser opens:

1. Choose the Slack workspace Murph should use.
2. Approve the requested bot and user scopes.
3. Return to the terminal and continue setup.

Murph uses the OAuth callback to save the Slack workspace and identify the Slack user who authorized the app. That user becomes the Slack owner Murph watches for by default.

If you are running the full `murph setup` wizard, setup continues into channel selection. If you ran only `murph setup slack`, choose channels afterward:

```bash
murph setup channels
```

Public channels can be joined automatically when Slack permissions allow it. Private channels must already include the Slack app.

## Local Storage

Slack secrets are stored locally:

```text
~/.murph/.credentials
```

Non-secret Slack setup values are stored locally:

```text
~/.murph/config.yaml
```

## Verify Setup

Run:

```bash
murph doctor
```

Then start a short test session and mention Murph in a watched Slack channel.

## Reconnect Search

Murph can use Slack user search when the `search:read` user scope is approved. Reconnect Slack after adding the user scope or changing user-search consent:

```bash
murph setup slack --reconnect-search
```

Reconnect stores a fresh user-search token locally.

## Troubleshooting

### Redirect URI Mismatch

The redirect URL is missing or does not match exactly.

Fix it in Slack app dashboard -> **OAuth & Permissions** -> **Redirect URLs**. Add the exact URI printed by setup, including scheme, host, port, and path.

Default:

```text
http://localhost:5173/api/slack/oauth/callback
```

### App Configuration Token Looks Like An App-Level Token

The app configuration token and app-level token are different.

- App configuration token: used once to create or update the app from the manifest.
- App-level token: starts with `xapp-` and is used for Socket Mode.

Create the app configuration token from Slack's app manifest/configuration flow, then rerun setup.

### Socket Mode Is Not Connected

Check **Socket Mode** in the Slack app dashboard:

1. Socket Mode is enabled.
2. The app-level token exists.
3. The app-level token has `connections:write`.
4. The `xapp-...` token was pasted into setup.

Then restart Murph or rerun:

```bash
murph setup slack
```

### Channels Do Not Load

Reconnect Slack and verify the app is installed in the expected workspace.

For public channels, check that the app has `channels:read`, `channels:join`, and the required message history scopes. For private channels, invite the Slack app directly into the channel.

Then rerun:

```bash
murph setup channels
```

### Owner Identity Is Missing

Reconnect Slack through Murph's OAuth flow. Murph uses the Slack OAuth callback to save only the authorizing user as the owner.

```bash
murph setup slack
```

## Runtime Path

Each Slack handoff follows the same path:

```text
Slack channel -> context -> grounded draft -> policy -> send | queue | skip
```
