---
title: Integrations
description: Connect context sources and tools Murph can use while grounding work.
---

# Integrations

Integrations give Murph access to the context it needs to answer safely.

## Built-in integrations

- Notion
- GitHub
- Gmail
- Google Calendar
- Granola
- Obsidian

Connect integrations from setup or the local UI.

## What integrations provide

An integration can provide:

- read-only tools
- context sources for grounding
- session-start context
- credential status for setup

Murph enables capabilities when an integration is connected, so the model can use relevant tools without a hidden second step.

## Scoped plugins

Murph Agent can create scoped plugins under `~/.murph/plugins/<id>`.

A scoped plugin can contribute:

- skills
- read-only integration adapters

Scoped plugins are the preferred way to add local/custom integrations without editing Murph core source.

Use the agent when building a new integration:

```bash
murph agent
```

Then ask it to create or update a scoped plugin.
