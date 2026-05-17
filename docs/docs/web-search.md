---
title: Web Search
description: Configure Murph's default Brave-backed web search and simple web fetch tools.
---

# Web Search

Murph includes web tools so the agent can discover public information and fetch explicit URLs when grounding a reply.

## Defaults

`web.search` uses Brave Search by default:

```yaml
integrations:
  webSearch:
    backend: brave
```

Set the key in `.env`:

```text
BRAVE_SEARCH_API_KEY=...
```

`web.fetch` reads an explicit `http(s)` URL with a simple HTTP fetch and text extraction. It is intentionally lightweight for now and does not run a browser crawler by default.

## Why Brave by default

Brave is a practical hosted default for public search: it is simple to configure, avoids running local search infrastructure, and gives Murph a dependable baseline for web discovery.

Tavily is also supported out of the box, and self-hosted options can be added through the same provider shape when a deployment needs a different privacy, cost, or control posture.

## Extending search and fetch

The shipped web tools are defaults, not a closed provider model. Add new providers behind the existing contracts:

- `web.search` for public result discovery
- `web.fetch` for explicit URL retrieval and readable text extraction

This keeps the runtime stable while allowing hosted providers, self-hosted search, or richer fetch/extraction backends later.

See [Configuration](/docs/configuration) and [Integrations](/docs/integrations).
