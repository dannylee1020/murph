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

Store the Brave key through setup or the browser UI. Murph saves it as a local credential in `~/.murph/.credentials`.

To use Tavily instead, save the backend choice in `~/.murph/config.yaml`:

```yaml
integrations:
  webSearch:
    backend: tavily
```

`web.fetch` reads an explicit `http(s)` URL with a simple HTTP fetch and text extraction. It is intentionally lightweight for now and does not run a browser crawler by default.

## Why Brave by default

Brave is a practical hosted default for public search: it is simple to configure, avoids running local search infrastructure, and gives Murph a dependable baseline for web discovery.

Tavily is also supported out of the box, and self-hosted options can be added through the same provider shape when a deployment needs a different privacy, cost, or control posture.

For development or hosted deployments, `BRAVE_SEARCH_API_KEY`, `TAVILY_API_KEY`, and `MURPH_WEB_SEARCH_BACKEND` still work as explicit runtime overrides. For normal local setup, prefer `~/.murph/config.yaml` and `~/.murph/.credentials`.

## Extending search and fetch

The shipped web tools are defaults, not a closed provider model. Add new providers behind the existing contracts:

- `web.search` for public result discovery
- `web.fetch` for explicit URL retrieval and readable text extraction

This keeps the runtime stable while allowing hosted providers, self-hosted search, or richer fetch/extraction backends later.

See [Configuration](/docs/configuration) and [Integrations](/docs/integrations).
