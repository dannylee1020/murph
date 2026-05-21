---
title: Discord
description: Connect Discord as a Murph channel.
---

# Discord

Discord setup has a few manual Developer Portal steps. Do those first, then let `murph setup discord` validate the app, open the authorization flow, and save the server, owner, and watched channels.

## What You Need

- Access to the [Discord Developer Portal](https://discord.com/developers/applications).
- Permission to add a bot to the Discord server Murph should watch.
- Murph running on the same local URL you will register as the OAuth redirect URI. The default is:

```text
http://localhost:5173/api/discord/oauth/callback
```

If you use a custom `MURPH_URL`, `MURPH_PORT`, or `DISCORD_REDIRECT_URI`, register the exact callback URL printed by `murph setup discord` instead.

## Step 1: Create Or Open The Discord App

1. Open the [Discord Developer Portal](https://discord.com/developers/applications).
2. Create a new application for Murph, or open the existing Murph application.
3. Keep the application page open. You will need both the **Bot** page and the **OAuth2** page.

## Step 2: Create The Bot And Copy The Bot Token

1. Go to **Bot**.
2. Add a bot if the application does not already have one.
3. Generate or reset the bot token.
4. Keep the bot token ready for `murph setup discord`.

Murph stores the bot token locally in `~/.murph/.credentials`.

## Step 3: Copy The OAuth2 Client Secret

1. Go to **OAuth2**.
2. Copy the application client secret.
3. Keep the client secret ready for `murph setup discord`.

Murph uses the client secret only to complete Discord's OAuth2 callback and identify the Discord user who authorized Murph.

## Step 4: Add The Redirect URI

In **OAuth2** -> **General** -> **Redirects**, add the exact Murph callback URL:

```text
http://localhost:5173/api/discord/oauth/callback
```

Save the Discord application after adding it.

This step is manual. Discord requires redirect URIs to be registered in the Developer Portal before OAuth2 authorization. Murph can check and print the expected URI, but it cannot reliably add the redirect URI through Discord's API.

## Step 5: Enable Required Bot Settings

On the **Bot** page, enable these privileged gateway intents:

- **Server Members Intent**: lets Murph fetch server members for owner lookup.
- **Message Content Intent**: lets Murph read Discord message text at runtime.

Murph tries to configure limited intent flags and default install permissions through Discord's API. If Discord rejects that update, enable the intents manually and continue.

## Step 6: Run Discord Setup

Run:

```bash
murph setup discord
```

Setup will ask for:

1. Discord bot token.
2. Discord client secret.

Then Murph will:

- validate the bot token;
- derive and save the Discord client ID;
- check the OAuth redirect URI when Discord returns it;
- configure bot install permissions when Discord allows it;
- print and open the Discord authorization URL.

## Step 7: Approve The Discord Authorization

When the browser opens:

1. Choose the Discord server Murph should use.
2. Approve the requested bot permissions.
3. Approve account identification.
4. Return to the terminal and press Enter when setup asks.

Murph uses the OAuth callback to save the Discord server and identify the Discord user who authorized the app. That user becomes the Discord owner Murph watches for by default.

## Step 8: Choose Channels

If you are running the full `murph setup` wizard, setup continues into channel selection. If you ran only `murph setup discord`, choose channels afterward:

```bash
murph setup channels
```

If channel listing is unavailable, paste Discord channel IDs when prompted. Murph validates pasted IDs through Discord when the bot has access.

## Bot Permissions

Murph requests this scoped permission set:

- View Channels
- Send Messages
- Embed Links
- Read Message History
- Send Messages in Threads

Do not grant Administrator unless you explicitly want to. Murph only needs access to the channels it should watch and reply in.

## Local Storage

Discord secrets are stored locally:

```text
~/.murph/.credentials
```

Non-secret Discord setup values are stored locally:

```text
~/.murph/config.yaml
```

## Verify Setup

Run:

```bash
murph doctor
```

Then start a short test session and mention Murph in a watched Discord channel.

## Troubleshooting

### Invalid OAuth Redirect

The redirect URI is missing or does not match exactly.

Fix it in Discord Developer Portal -> **OAuth2** -> **General** -> **Redirects**. Add the exact URI printed by setup, including scheme, host, port, and path.

Default:

```text
http://localhost:5173/api/discord/oauth/callback
```

### Invalid Form Body During App Configuration

Discord rejected Murph's best-effort application update. Continue with manual setup:

1. Open the **Bot** page.
2. Enable **Server Members Intent**.
3. Enable **Message Content Intent**.
4. Re-run `murph setup discord` if needed.

### Missing Access Or Channel Listing Fails

The bot cannot see the selected channel.

Check that the bot is installed in the server and has channel-level access to:

- View Channels
- Send Messages
- Read Message History
- Send Messages in Threads

Then rerun:

```bash
murph setup channels
```

### Member Listing Fails

Enable **Server Members Intent** in the Developer Portal. If listing still fails, setup can fall back to a manual Discord user ID.
