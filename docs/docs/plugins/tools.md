---
title: Tools
description: Add read-only callable actions from scoped plugins.
---

# Tools

A tool is one callable action Murph can run.

Examples include built-in web search and plugin-provided source search. A Linear integration can expose a `linear.search` tool.

For the full tool contract, retrieval settings, and examples, use [Extending Tools](/docs/developing/extending/tools).

## Built-in web tools

Murph includes built-in web tools for public information:

- `web.search` discovers public web results through Brave Search.
- `web.fetch` reads an explicit `http(s)` URL and extracts readable text with a simple HTTP fetch.

These are tools, not integrations. They do not connect a private workspace source.

Configure Brave in `~/.murph/config.yaml`:

```yaml
integrations:
  webSearch:
    backend: brave
```

Store the Brave key through setup or the browser UI. Murph saves it as a local credential in `~/.murph/.credentials`.

`web.fetch` is intentionally lightweight for now and does not run a browser crawler by default.

Brave is the documented default for public search: it is simple to configure, avoids running local search infrastructure, and gives Murph a dependable baseline for web discovery.

For development or hosted deployments, `BRAVE_SEARCH_API_KEY` and `MURPH_WEB_SEARCH_BACKEND` still work as explicit runtime overrides. For normal local setup, prefer `~/.murph/config.yaml` and `~/.murph/.credentials`.

## Integration relationship

Integrations group source-specific tools. Tools do the actual work.

## Read-only requirement

Scoped plugin tools must be read-only:

```js
sideEffectClass: 'read'
```

Tools with write side effects are rejected by the scoped plugin loader.

## Search shape

Searchable integrations should expose a read-only `{ query, limit }` search tool.

## Retrieval eligibility

Set `retrievalEligible: true` when Murph can use the tool during retrieval.

```js
retrievalEligible: true
```

## Retrieval profile

Use a retrieval profile that matches the source:

```js
retrieval: { profile: 'work_item' }
```

Common profiles include `title_keywords`, `work_item`, `code_review`, `email_thread`, `team_discussion`, and `generic`.

## Tool names

Use source-prefixed names such as `linear.search` or `docs.search` so tool purpose is clear in traces and triage.

## Extending search and fetch

The shipped web tools are defaults, not a closed model. Add custom search or fetch behavior behind the existing contracts:

- `web.search` for public result discovery
- `web.fetch` for explicit URL retrieval and readable text extraction
