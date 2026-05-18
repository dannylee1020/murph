---
title: Slack Agent
description: Use Murph as a local-first AI handoff agent for Slack.
---

# Slack Agent

Murph can watch selected Slack channels while you are away, draft grounded replies, apply policy, and leave a review trail for every decision.

## When to use it

Use Murph for Slack when you want an async handoff agent that stays under your control:

- keep important Slack channels covered while offline
- answer routine questions from your real workspace context
- queue risky replies for review instead of sending automatically
- review what was sent, queued, skipped, and why

## How it works

Murph uses Slack Socket Mode by default, so local development does not require a public Events URL. During setup, Murph asks for Slack credentials, stores bot and user-search tokens in `~/.murph/.credentials`, guides workspace installation, and lets you choose watched channels. Reconnect Slack after adding new scopes so Murph can store a fresh user-search token.

```bash
murph setup slack
murph start
```

Each handoff session follows the same path:

```text
Slack channel -> context -> grounded draft -> policy -> send | queue | skip
```

## What to configure

- Slack app credentials and workspace installation
- watched channels for the handoff session
- provider keys for OpenAI or Anthropic
- policy profile for send, queue, and skip behavior
- context integrations such as GitHub, Gmail, Calendar, Notion, Granola, or Obsidian

Start with [Channels](/docs/channels) and [Configuration](/docs/configuration).

## Limits

Murph only watches channels you select. Conservative policy profiles keep auto-send off by default, so sensitive or ambiguous Slack replies stay queued unless you explicitly allow more autonomy.
