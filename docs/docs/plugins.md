---
title: Plugins
description: Extend Murph with scoped local plugin packages.
---

# Plugins

Plugins are local extension packages that add behavior without editing Murph core source.

## Scoped plugins

Scoped plugins live under one of these roots:

```text
~/.murph/plugins/<category>/<id>
./plugins/<category>/<id>
```

Use `~/.murph/plugins/<category>/<id>` for user-local extensions. Use `./plugins/<category>/<id>` for repo-local development.

Categories keep extension types separated:

- `channels` for advanced Slack/Discord-style messaging provider extensions.
- `tools` for connector-backed tools.
- `skills` for prompt guidance.
- `context` for grounding sources.
- `bundles` for plugins that intentionally combine multiple categories.

Murph still loads older flat plugin directories under `plugins/<id>` for compatibility, but new plugins should use the category-first layout.

## Capabilities

A scoped plugin can contribute:

- [channels](/docs/plugins/channels)
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

Then ask it to create or update a plugin under the right category root, such as `~/.murph/plugins/tools/linear`.

For a new messaging provider, ask Murph Agent to create a channel plugin under `~/.murph/plugins/channels/<id>`. A custom channel should not require edits to Murph core runtime files, but it may still require manual app, bot, scope, webhook, or approval steps in the provider's console.
