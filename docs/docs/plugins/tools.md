---
title: Tools
description: Add read-only callable actions from scoped plugin connectors.
---

# Tools

A tool is one callable action Murph can run.

Examples include built-in web search and plugin-provided source search. A Linear connector can expose a `linear.search` tool.

## Connector relationship

Connectors group tools by source. Tools do the actual work.

## Read-only requirement

Scoped plugin tools must be read-only:

```js
sideEffectClass: 'read'
```

Tools with write side effects are rejected by the scoped plugin loader.

## Search shape

Searchable connectors should expose a read-only `{ query, limit }` search tool.

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
