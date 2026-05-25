---
name: plugin
description: Create or update Murph scoped plugins for integrations, tools, context sources, skills, or bundles. Use when the operator asks to add a local Murph capability without editing core source.
---

# Plugin

Use this skill when creating or updating scoped plugins.

## Workflow

1. Search the docs first with `murph_docs_search` for plugin terminology, package structure, and examples.
2. Inspect plugin status with `murph_plugin_status` when the request concerns installed plugins.
3. Prefer `murph_plugin_create_draft` for new plugins under `~/.murph/plugins/<category>/<id>`.
4. For integrations, fill the connector metadata completely: id, name, description, credential type, credential label, env key, tools, and context sources.
5. Edit only plugin files unless the operator explicitly wants core source edits.
6. Validate with `murph_plugin_validate`.
7. Reload or install with `murph_plugin_install` or `murph_plugin_reload`.
8. Confirm integration plugins appear in `/api/integrations/status` so the browser UI can render the card from runtime metadata.

## Boundaries

- Use `channels` for messaging providers.
- Use `tools` for callable read-only actions.
- Use `context` for retrievable evidence sources.
- Use `skills` for runtime prompt guidance.
- Use `bundles` only when one package intentionally combines categories.
- Do not edit core UI for a new integration card. The browser UI renders cards from `/api/integrations/status`.
- Only change core UI when adding a reusable setup primitive that multiple integrations can share.
- Do not put new plugins under the Murph app source tree.
- Do not ask the user to paste credentials into chat.
