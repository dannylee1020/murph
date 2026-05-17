---
title: Local-first AI Agent
description: Understand Murph's local-first approach to AI handoff automation.
---

# Local-first AI Agent

Murph is designed as a local-first AI agent. It runs on your machine, stores runtime state locally, and keeps credentials encrypted instead of making a hosted service the default control plane.

## What local-first means

Murph keeps the core handoff workflow close to your environment:

- local SQLite for runtime state
- encrypted credentials
- setup through the `murph` CLI or local browser UI
- explicit provider keys for OpenAI or Anthropic
- policy-controlled autonomy for sending, queuing, or skipping replies

This makes Murph a fit for founders, operators, developers, and small teams that want async automation without handing every workflow to a hosted agent.

## Handoff workflow

Murph starts from channels you choose, not from a global inbox:

```text
selected channel -> context -> grounded draft -> policy -> send | queue | skip
```

The agent can use connected context sources such as docs, GitHub, Gmail, Calendar, meetings, and local notes, then records what happened for review.

## Extensibility

Murph ships defaults for channels, providers, web search, fetch, policy profiles, and storage. Those defaults are not a closed set.

New channels, integrations, skills, policies, model providers, search providers, and fetch backends should plug into the existing extension points instead of changing the handoff workflow.

## Start locally

```bash
curl -fsSL https://murph-agent.com/install.sh | bash
murph setup
murph start
```

Use [Quickstart](/docs/quickstart) for the full setup path.
