---
title: Plugin Status
description: Inspect scoped plugin load status.
---

# Plugin Status

Plugin status shows which scoped plugins loaded, failed, or were skipped.

## Endpoint

```bash
curl -s http://localhost:5173/api/plugins/status
```

## Loaded plugins

Loaded plugins include their id, name, version, root, and registered capabilities.

## Failed plugins

Failed plugins include an error message from manifest parsing, skill parsing, path validation, or connector validation.

## Capability lists

Status responses list registered skill names and connector ids for each plugin.
