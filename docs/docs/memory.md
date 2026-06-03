---
title: Memory
description: Understand Murph's runtime memory and source index.
---

# Memory

Murph uses SQLite as its transactional runtime memory source.

SQLite stores:

- sessions and runs
- run events and tool calls
- policy decisions and action results
- workspace memory
- thread memory
- user preferences for Personal routing
- source index refresh status

## Configure memory

Memory lives in the runtime database on the machine running Murph. Configure the SQLite path in `~/.murph/config.yaml`:

```yaml
app:
  sqlitePath: data/murph.sqlite
```

Use `MURPH_SQLITE_PATH` only when you need a process-level override, such as tests, development, or a hosted deployment.

## How Murph uses memory

When a request arrives, Murph builds context from the current thread, SQLite workspace memory, SQLite thread memory, source-index hints, and live retrieval from connected sources.

Stored memory is not a substitute for current evidence. For latest, current, today, now, status, changed, or source-of-truth questions, Murph should use live retrieval from connected sources before answering.

For Team deployments, runtime memory is scoped to the workspace, session, channel, and thread. For Personal deployments, owner identity is also used for direct-message memory.

## Source index

Murph also maintains a generated source index under the local memory root:

```text
~/.murph/memory/source-index/
```

The source index is a routing catalog. It stores lightweight metadata, routing notes, read-tool hints, and status for resources in connected integrations. It helps Murph decide where to look before calling live retrieval tools.

The source index is not factual grounding evidence. It should point Murph toward the right connected source, then the runtime should use current thread content, connected integration reads, or read-only tool results as evidence.

Source indexing is enabled by default. The runtime checks it at startup and during heartbeat. The heartbeat runs every 15 minutes by default, source-index refreshes are due every 24 hours by default, and failed providers retry after 1 hour by default.

Supported source-index providers depend on the runtime distribution:

| Runtime | Indexed providers |
| --- | --- |
| Team | GitHub, Linear, Notion |
| Personal | GitHub, Linear, Notion, Granola, Obsidian |

Google is intentionally live-retrieval only for now and is not source-indexed.
