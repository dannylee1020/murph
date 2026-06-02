---
title: Extending Plugins
description: Build scoped plugin packages that Murph can discover and validate.
---

# Extending Plugins

Plugins are local packages that contribute channels, connector modules, skills, or read-only tools.

Plugins are installed, reloaded, and governed at the host level. In a Team host, the operator decides which plugin code is available to the shared runtime. Use policy, channel scope, and source configuration to limit when a host plugin is used.

## Directory layout

Create one package under a category root:

```text
~/.murph/plugins/channels/teams
~/.murph/plugins/context/jira
~/.murph/plugins/skills/escalation
~/.murph/plugins/tools/internal-search
~/.murph/plugins/bundles/customer-ops
```

Use `bundles` only when one package intentionally combines multiple capability types.

## Manifest

Every scoped plugin needs `plugin.json`:

```json
{
  "id": "jira",
  "name": "Jira",
  "description": "Jira issue and project context",
  "version": "0.1.0",
  "capabilities": {
    "skills": ["skills/jira.md"],
    "integrations": ["integrations/jira.mjs"]
  }
}
```

Required fields:

- `id`: stable id using letters, numbers, dots, underscores, or hyphens.
- `name`: display name used in plugin status.
- `description`: short operator-facing purpose.
- `capabilities`: at least one of `skills`, `integrations`, or `channels`.

Capability paths are relative to the plugin root. Paths that escape the package root are rejected.

## Capability files

Use conventional paths:

```text
plugin.json
skills/<id>.md
integrations/<id>.mjs
channel.mjs
```

`capabilities.skills` points to Markdown skill files. `capabilities.integrations` points to connector modules. `capabilities.channels` points to channel plugin modules.

Integration connector metadata is runtime UI metadata too. After reload, `/api/integrations/status` exposes plugin-provided integrations so the browser UI can render generic cards without source changes.

## Loading and validation

Reload scoped plugins after changing manifests or capability files:

```bash
curl -s -X POST http://localhost:5173/api/plugins/reload
```

Inspect status:

```bash
curl -s http://localhost:5173/api/plugins/status
```

Failed plugins return a validation error without blocking other valid packages.

## Safety rules

- Scoped plugin connector tools must be read-only.
- A connector module cannot contribute a channel adapter or model provider.
- A channel plugin id must match the manifest id.
- A channel runtime id must match the channel id.
- Skill files must include parseable frontmatter.

Ask `murph agent` to scaffold or inspect a plugin when you want it to write the package and call validation APIs for you.
