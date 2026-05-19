---
title: Package Structure
description: Structure a scoped Murph plugin package.
---

# Package Structure

A scoped plugin is a directory with a manifest and declared capability files.

## Root directory

Use one plugin directory per plugin:

```text
~/.murph/plugins/linear
```

The directory name should match the plugin id when possible.

## Manifest

Every plugin needs `plugin.json`:

```json
{
  "id": "linear",
  "name": "Linear",
  "description": "Linear plugin",
  "version": "0.1.0",
  "capabilities": {
    "skills": ["skills/linear.md"],
    "adapters": ["adapters/linear.mjs"]
  }
}
```

The manifest must declare at least one skill or adapter.

## Skills directory

Use `skills/*.md` for skill files referenced by `capabilities.skills`.

## Adapters directory

Use `adapters/*.mjs` for connector modules referenced by `capabilities.adapters`.

The directory is named `adapters` because that is the runtime field name. In docs, treat each adapter module as a connector for one outside source.

## Path boundary

Manifest paths must stay inside the plugin root. Paths that escape the package root are rejected.
