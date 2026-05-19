---
title: Plugins
description: Extend Murph with scoped local plugin packages.
---

# Plugins

Plugins are local extension packages that add behavior without editing Murph core source.

## Scoped plugins

Scoped plugins live under one of these roots:

```text
~/.murph/plugins/<id>
./plugins/<id>
```

Use `~/.murph/plugins/<id>` for user-local extensions. Use `./plugins/<id>` for repo-local development.

## Capabilities

A scoped plugin can contribute:

- [skills](/docs/plugins/skills)
- [connectors](/docs/plugins/connectors)
- [read-only tools](/docs/plugins/tools)

## Connectors and tools

A connector is the plugin module for one outside source, such as Linear or an internal docs index.

A tool is one callable action exposed by a connector, such as `linear.search`.

## Public boundary

Scoped plugins are the documented plugin model. Keep custom integrations in scoped plugins unless a change must become part of Murph core.

## Build workflow

Use [Murph Agent](/docs/usage/murph-agent) to create or update scoped plugins:

```bash
murph agent
```

Then ask it to create or update a plugin under `~/.murph/plugins/<id>`.
