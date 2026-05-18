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
- Web search and fetch

Connect integrations from setup or the local UI.

## What integrations provide

An integration can provide:

- read-only tools
- context sources for grounding
- session-start context
- credential status for setup

Murph enables capabilities when an integration is connected, so the model can use relevant tools without a hidden second step.

## Web tools

`web.search` discovers public web results. Brave is the default backend; Tavily can be selected in configuration.

`web.fetch` reads an explicit `http(s)` URL and extracts readable text with a simple HTTP fetch. It is intentionally lightweight for now and does not run a browser crawler such as Crawl4AI.

The shipped providers are just defaults. Murph's integration model is meant to grow: a new web search provider, self-hosted search service, or richer fetch/extraction backend can be added behind the existing tool shape instead of changing how the runtime asks for web context.

## Scoped plugins

Murph Agent can create scoped plugins under `~/.murph/plugins/<id>`.

A scoped plugin can contribute:

- skills
- read-only integration adapters

Scoped plugins are the preferred way to add local/custom integrations without editing Murph core source.

Searchable adapters should expose a read-only `{ query, limit }` search tool with `retrievalEligible: true` and a `retrieval.profile` such as `title_keywords`, `work_item`, `code_review`, `email_thread`, `team_discussion`, or `generic`. This lets Murph normalize vague user requests without requiring core source edits for every new integration.

Use the agent when building a new integration:

```bash
murph agent
```

Then ask it to create or update a scoped plugin.
