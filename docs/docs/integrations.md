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
- credential status for setup

Murph enables capabilities when an integration is connected, so the model can use relevant tools without a hidden second step.

## Web tools

`web.search` discovers public web results. Brave is the default backend; Tavily can be selected in configuration.

`web.fetch` reads an explicit `http(s)` URL and extracts readable text with a simple HTTP fetch. It is intentionally lightweight for now and does not run a browser crawler such as Crawl4AI.

The shipped providers are just defaults. Murph's integration model is meant to grow: a new web search provider, self-hosted search service, or richer fetch/extraction backend can be added behind the existing tool shape instead of changing how the runtime asks for web context.

## Custom integrations

Use [Plugins](/docs/plugins) when you want to add a local or custom integration without editing Murph core source.
