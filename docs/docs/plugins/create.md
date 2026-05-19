---
title: Create a Plugin
description: Create a scoped plugin with Murph Agent.
---

# Create a Plugin

Use Murph Agent when creating or updating scoped plugins.

## Start Murph Agent

```bash
murph agent
```

## Ask for a scoped plugin

Ask Murph Agent to create a plugin under `~/.murph/plugins/<id>`.

Example request:

```text
Create a scoped plugin for Linear that adds a skill, a connector, and a read-only search tool.
```

## Keep source edits off

Normal plugin work should stay inside the plugin package. Do not use source-edit mode unless the change must modify Murph core.

## Verify the package

Reload plugins after the files are created:

```bash
curl -s -X POST http://localhost:5173/api/plugins/reload
```

Then check plugin status:

```bash
curl -s http://localhost:5173/api/plugins/status
```
