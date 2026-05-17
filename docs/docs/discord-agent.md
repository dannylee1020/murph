---
title: Discord Agent
description: Use Murph as a local-first AI handoff agent for Discord.
---

# Discord Agent

Murph can use the same channel-adapter model for Discord that it uses for Slack: watch selected channels, gather context, draft replies, apply policy, and keep a review trail.

## When to use it

Use Murph for Discord when your team or community needs coverage during offline windows:

- monitor selected Discord channels while you are away
- draft answers from connected docs, tickets, GitHub, and notes
- queue replies that need human review
- keep a local audit trail of decisions

## How it works

Configure Discord through setup, then start Murph locally:

```bash
murph setup
murph start
```

Murph only acts inside selected channels for an active handoff session. Policy still decides whether a draft can be sent, should be queued, or should be skipped.

## What to configure

- Discord credentials
- watched channels
- AI provider keys
- policy profile
- context sources for grounded replies

See [Channels](/docs/channels), [Configuration](/docs/configuration), and [Integrations](/docs/integrations).

## Limits

Slack is the most complete setup path today. Discord follows the same architecture, but you should verify channel behavior with `murph doctor` and a short test session before relying on it for production handoffs.
