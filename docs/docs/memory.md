---
title: Memory
description: Understand Murph's local recall layer.
---

# Memory

Murph keeps one runtime memory layer on the runtime host.

SQLite is the transactional source of truth. It stores sessions, runs, events, tool calls, policy decisions, action results, subscriber memory, workspace memory, and thread memory.

## Configure memory

Memory lives on the same machine as the Murph runtime. If you run Murph on your laptop, that is your laptop. If you run Murph on a VPS or home server, that host owns SQLite and optional generated exports.

Normal configuration belongs in `~/.murph/config.yaml`:

```yaml
app:
  sqlitePath: data/murph.sqlite
  memoryPath: ~/.murph/memory
```

`sqlitePath` controls the transactional database on the runtime host. `memoryPath` controls optional generated operator exports on that same host.

## Generated files

Murph may write generated operator exports under the configured `app.memoryPath`.

The important files are:

- `index.md`: a compact generated index of available memory pages.
- `threads/...`: generated pages for prior thread activity.
- `sessions/...`: generated pages for prior session activity.

These files are generated from SQLite run history for operator inspection and debugging. They are not agent-readable runtime memory. Edit `~/.murph/config.yaml` to change where they live; do not hand-edit generated memory pages as configuration.

## What gets indexed

Murph indexes completed runs in the background after the runtime finishes handling a request.

A run is useful for export when it includes successful non-memory read evidence, such as connected source results, thread context, or read-only tool output. Export pages preserve run ids, event ids, sources, timestamps, freshness notes, and the request/result timeline.

Failed or missing live reads are not treated as source evidence just because a memory page exists.

## How Murph Uses Memory

When a new request arrives, Murph builds a small runtime context from typed SQLite state: current thread messages, subscriber memory, workspace memory, subscriber-scoped thread memory, and live retrieval from enabled tools.

Markdown exports are cached history with provenance, not source-of-truth runtime context. If the request asks for latest, current, today, now, status, changed, or source-of-truth information, Murph should use live retrieval from connected sources instead of answering from stored memory alone.

For shared-host deployments, subscriber memory is scoped by workspace and target user. Thread memory is also scoped by workspace, channel, thread, and target user so two subscribers can participate in the same channel thread without sharing private runtime memory.
