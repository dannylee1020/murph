---
title: Web Search
description: Configure Murph's Brave-backed web search and simple web fetch tools.
---

# Web Search

Murph includes built-in web tools for public information:

- `web.search` discovers public web results through Brave Search.
- `web.fetch` reads an explicit `http(s)` URL and extracts readable text with a simple HTTP fetch.

These are tools, not integrations. They do not connect a private workspace source.

## Configure Brave

```yaml
integrations:
  webSearch:
    backend: brave
```

Store the Brave key through setup or the browser UI. Murph saves it as a local credential in `~/.murph/.credentials`.

`web.fetch` reads an explicit `http(s)` URL with a simple HTTP fetch and text extraction. It is intentionally lightweight for now and does not run a browser crawler by default.

## Why Brave by default

Brave is the documented default for public search: it is simple to configure, avoids running local search infrastructure, and gives Murph a dependable baseline for web discovery.

For development or hosted deployments, `BRAVE_SEARCH_API_KEY` and `MURPH_WEB_SEARCH_BACKEND` still work as explicit runtime overrides. For normal local setup, prefer `~/.murph/config.yaml` and `~/.murph/.credentials`.

## Extending search and fetch

The shipped web tools are defaults, not a closed model. Add custom search or fetch behavior behind the existing contracts:

- `web.search` for public result discovery
- `web.fetch` for explicit URL retrieval and readable text extraction

This keeps Murph stable while allowing hosted providers, self-hosted search, or richer fetch/extraction backends later.

See [Configuration](/docs/configuration), [Integrations](/docs/integrations), and [Plugin Tools](/docs/plugins/tools).
