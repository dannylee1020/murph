---
title: Reload Plugins
description: Reload scoped plugins without restarting Murph.
---

# Reload Plugins

Reload plugins after adding or changing scoped plugin files.

## Endpoint

```bash
curl -s -X POST http://localhost:5173/api/plugins/reload
```

The response includes the current load status for each discovered scoped plugin.

## What reload does

Reload unregisters plugin-sourced capabilities and loads scoped plugins again.

## When to reload

Reload after editing `plugin.json`, skill files, or connector modules.

## Failed reloads

A failed plugin reports an error in the response. Other valid plugins can still load.
