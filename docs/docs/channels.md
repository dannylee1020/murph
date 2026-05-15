---
title: Channels
description: Connect messaging surfaces that Murph can watch.
---

# Channels

Channels are the messaging surfaces Murph watches while you are offline.

## Supported channels

- Slack
- Discord

Slack is the most complete setup path today.

## Slack

Murph uses Slack Socket Mode by default. This avoids exposing a public Events URL during local development.

The Slack app manifest is available at:

```text
/slack-socket-mode-manifest.yml
```

During setup, Murph asks for Slack credentials and then guides you through workspace installation.

```bash
murph setup slack
```

The OAuth redirect URL is:

```text
http://localhost:5173/api/slack/oauth/callback
```

## Discord

Discord support uses the same channel-adapter model as Slack. Configure it through setup and keep credentials in local environment settings.

## Watched channels

Murph only watches the channels you select for a session. Use setup to choose defaults, then start a session when you want coverage.
