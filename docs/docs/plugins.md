---
title: Plugins
description: Extend Murph with scoped local plugin packages.
---

# Plugins

Plugins are local extension packages that add channels, custom integrations, tools, or skills to Murph.

## Scoped plugins

Scoped plugins live under the Murph home directory:

```text
~/.murph/plugins/<category>/<id>
```

Plugins are global operator extensions. Runtime scope comes from Murph configuration, channels, integrations, and policy, not from the local shell directory where Murph is started.

Categories keep extension types separated:

- `channels` for messaging provider extensions.
- `tools` for callable actions.
- `skills` for prompt guidance.
- `context` for integration-style grounding sources.
- `bundles` for plugins that intentionally combine multiple categories.

Murph still loads older flat plugin directories under `~/.murph/plugins/<id>` for compatibility, but new plugins should use the category-first layout.

## Capabilities

A scoped plugin can contribute:

- [channels](/docs/plugins/channels)
- custom integrations through [connector modules](/docs/plugins/connectors)
- [skills](/docs/plugins/skills)
- [read-only tools](/docs/plugins/tools)

## Package structure

Use one plugin directory per plugin under a capability category:

```text
~/.murph/plugins/tools/linear
~/.murph/plugins/channels/teams
~/.murph/plugins/context/internal-docs
```

The directory name should match the plugin id when possible.

Every plugin needs `plugin.json`:

```json
{
  "id": "linear",
  "name": "Linear",
  "description": "Linear plugin",
  "version": "0.1.0",
  "capabilities": {
    "skills": ["skills/linear.md"],
    "integrations": ["integrations/linear.mjs"]
  }
}
```

The manifest must declare at least one skill, integration, or channel.

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

Use these directories:

- `skills/*.md` for skill files referenced by `capabilities.skills`.
- `integrations/*.mjs` for integration connector modules referenced by `capabilities.integrations`.
- `channel.mjs` or `channels/*.mjs` for messaging providers referenced by `capabilities.channels`.

Manifest paths must stay inside the plugin root. Paths that escape the package root are rejected.

## Integrations and tools

An integration is the connected source users think about, such as Linear or an internal docs index. In a plugin package, that integration is implemented by a connector module.

A tool is one callable action Murph can run. Some tools are built in, such as `web.search`; others are exposed by plugin-provided integrations, such as `linear.search`.

## Public boundary

Scoped plugins are the documented plugin model. Keep custom integrations in scoped plugins unless a change must become part of Murph core.

## Build workflow

Use [Murph Agent](/docs/usage/murph-agent) to create or update scoped plugins:

```bash
murph agent
```

Then ask it to create or update a plugin under the right category root, such as `~/.murph/plugins/tools/linear`.

For a new messaging provider, ask Murph Agent to create a channel plugin under `~/.murph/plugins/channels/<id>`. A custom channel should not require edits to Murph core runtime files, but it may still require manual app, bot, scope, webhook, or approval steps in the provider's console.
