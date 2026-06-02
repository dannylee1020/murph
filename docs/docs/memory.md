---
title: Memory
description: Understand Murph's SQLite-backed runtime memory.
---

# Memory

Murph uses SQLite as its runtime memory source.

SQLite stores:

- sessions and runs
- run events and tool calls
- policy decisions and action results
- workspace memory
- thread memory
- user preferences for Personal routing

## Configure memory

Memory lives in the runtime database on the machine running Murph. Configure the SQLite path in `~/.murph/config.yaml`:

```yaml
app:
  sqlitePath: data/murph.sqlite
```

Use `MURPH_SQLITE_PATH` only when you need a process-level override, such as tests, development, or a hosted deployment.

## How Murph uses memory

When a request arrives, Murph builds context from the current thread, SQLite workspace memory, SQLite thread memory, and live retrieval from connected sources.

Stored memory is not a substitute for current evidence. For latest, current, today, now, status, changed, or source-of-truth questions, Murph should use live retrieval from connected sources before answering.

For Team deployments, runtime memory is scoped to the workspace, session, channel, and thread. For Personal deployments, owner identity is also used for direct-message memory.
