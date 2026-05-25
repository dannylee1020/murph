---
title: Memory
description: Understand Murph's local recall layer.
---

# Memory

Murph keeps two local memory layers with different jobs.

SQLite is the transactional source of truth. It stores sessions, runs, events, tool calls, policy decisions, and action results.

The markdown memory directory is a generated recall layer. It gives Murph a compact way to remember what happened in earlier runs without re-reading every event from SQLite on every request.

## Configure memory

Normal configuration belongs in `~/.murph/config.yaml`:

```yaml
app:
  sqlitePath: data/murph.sqlite
  memoryPath: ~/.murph/memory
```

`sqlitePath` controls the transactional database. `memoryPath` controls where Murph writes generated markdown memory.

## Generated files

Murph writes generated memory under the configured `app.memoryPath`.

The important files are:

- `index.md`: a compact generated index of available memory pages.
- `threads/...`: generated pages for prior thread activity.
- `sessions/...`: generated pages for prior session activity.

These files are generated from SQLite run history. Edit `~/.murph/config.yaml` to change where they live; do not hand-edit generated memory pages as configuration.

## What gets indexed

Murph indexes completed runs in the background after the runtime finishes handling a request.

A run is useful for memory when it includes successful non-memory read evidence, such as connected source results, thread context, or read-only tool output. Memory pages preserve run ids, event ids, sources, timestamps, freshness notes, and the request/result timeline.

Failed or missing live reads are not treated as source evidence just because a memory page exists.

## How Murph uses memory

When a new request arrives, Murph may include the compact memory index in the agent context. For stable follow-up questions, the agent can use the index to choose one relevant memory page and read it with the memory page tool.

Markdown memory is cached evidence with provenance, not the source of truth for fresh state. If the request asks for latest, current, today, now, status, changed, or source-of-truth information, Murph should use live retrieval from connected sources instead of answering from memory alone.
