---
title: Package Structure
description: Structure a scoped Murph plugin package.
---

# Package Structure

A scoped plugin is a directory with a manifest and declared capability files.

## Root directory

Use one plugin directory per plugin under a capability category:

```text
~/.murph/plugins/tools/linear
~/.murph/plugins/channels/teams
./plugins/context/internal-docs
```

The directory name should match the plugin id when possible. Murph still loads legacy flat directories such as `~/.murph/plugins/linear`, but Murph Agent and new documentation use the category-first layout.

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

The manifest must declare at least one skill, connector module, or channel. Connector modules are listed under `capabilities.adapters` because that is the current manifest field name.

For a channel plugin:

```json
{
  "id": "teams",
  "name": "Microsoft Teams",
  "description": "Teams channel plugin",
  "version": "0.1.0",
  "capabilities": {
    "channels": ["channel.mjs"]
  }
}
```

## Skills directory

Use `skills/*.md` for skill files referenced by `capabilities.skills`.

## Connectors directory

Use `adapters/*.mjs` for connector modules referenced by `capabilities.adapters`.

The directory is named `adapters` because that is the current manifest field name. In user-facing docs, treat each module as a connector for one outside source.

## Channel modules

Use `channel.mjs` or `channels/*.mjs` for messaging providers referenced by `capabilities.channels`.

A channel module exports `channel` or a default channel descriptor. The descriptor owns runtime behavior, setup metadata, and ingress behavior for that provider. Adding a custom channel should only add files under `plugins/channels/<id>`.

Channel plugins keep provider code out of Murph core. They do not remove provider-console work such as app creation, scopes, bot permissions, webhook URLs, or provider approval.

## Path boundary

Manifest paths must stay inside the plugin root. Paths that escape the package root are rejected.
