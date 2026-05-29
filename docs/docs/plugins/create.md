---
title: Create and Manage Plugins
description: Create, reload, and inspect scoped plugins.
---

# Create and Manage Plugins

Use Murph Agent when creating or updating scoped plugins.

A plugin is a local extension package under `~/.murph/plugins`. Use one when you want Murph to understand a source, expose a read-only tool, add a skill, or support a messaging channel without changing Murph core source.

## Start Murph Agent

```bash
murph agent
```

## Ask for a scoped plugin

Ask Murph Agent to create a plugin under the matching category root:

```text
~/.murph/plugins/channels/<id>
~/.murph/plugins/tools/<id>
~/.murph/plugins/skills/<id>
~/.murph/plugins/context/<id>
```

Example request:

```text
Create a scoped plugin for Linear that adds a custom integration, a skill, and a read-only search tool.
```

For a channel:

```text
Create a local channel plugin for Microsoft Teams under ~/.murph/plugins/channels/teams. Do not edit Murph core runtime files. Guide me through any provider-console setup that cannot be automated.
```

Channel plugins are an advanced extension path. Murph Agent can scaffold code and guide setup, but most messaging providers still require manual app, bot, permission, webhook, or approval steps outside Murph.

## Keep source edits off

Normal plugin work should stay inside the plugin package. Do not use source-edit mode unless the change must modify Murph core.

Integration cards are runtime-driven. A connector's metadata flows through `/api/integrations/status`, and the browser UI renders a generic card from that response.

Only change core UI when the plugin needs a reusable setup primitive that other integrations can share, such as a new declarative field type.

## Verify the package

Reload plugins after the files are created or changed:

```bash
curl -s -X POST http://localhost:5173/api/plugins/reload
```

Reload unregisters plugin-sourced capabilities and loads scoped plugins again. The response includes the current load status for each discovered scoped plugin.

Reload after editing `plugin.json`, skill files, channel modules, or integration modules.

For integration plugins, also check the integration status response:

```bash
curl -s http://localhost:5173/api/integrations/status
```

The new integration should appear in the `integrations` list with its name, description, credential label, tools, and context sources. The browser UI uses the same list to show the card.

## Inspect plugin status

Check plugin status when a package does not load as expected:

```bash
curl -s http://localhost:5173/api/plugins/status
```

Loaded plugins include their id, name, version, root, and registered capabilities.

Failed plugins include an error message from manifest parsing, skill parsing, path validation, channel validation, or integration validation. Other valid plugins can still load when one plugin fails.

Status responses list registered channel ids, skill names, and integration ids for each plugin.
