---
title: Extending Murph
description: Choose the right extension point for custom Murph behavior.
---

# Extending Murph

Murph can be extended without editing core source for most local needs.

Use this section when you are building custom behavior for a workspace, source, or messaging provider. The user-facing [Plugins](/docs/plugins), [Channels](/docs/channels), and [Policy](/docs/policy) pages stay short; these pages document the implementation contracts.

## Use Murph Agent first

For most custom extension work, start with Murph Agent:

```bash
murph agent
```

Ask it to create or update the scoped plugin, skill, connector, channel plugin, or policy profile you need. Murph Agent can inspect your current setup, choose the right extension point, write files under the Murph home directory, reload plugins, and check status through Murph's local APIs.

Use the rest of this section as the implementation reference when you want to review what the agent created, make manual edits, or build an extension yourself.

## Choose an extension point

| Goal | Use |
| --- | --- |
| Add a local package Murph can discover | [Plugins](/docs/developing/extending/plugins) |
| Add one callable read-only action | [Tools](/docs/developing/extending/tools) |
| Teach Murph when and how to use a source | [Skills](/docs/developing/extending/skills) |
| Add a private source such as Jira, CRM, or docs | [Connectors / Integrations](/docs/developing/extending/connectors) |
| Add a messaging provider such as Teams | [Channels](/docs/developing/extending/channels) |
| Change send, queue, and abstain behavior | [Policy](/docs/developing/extending/policy) |

## Public path

The supported developer path is a scoped plugin under:

```text
~/.murph/plugins/<category>/<id>
```

Scoped plugins are loaded from the Murph home directory, not from the current shell working directory. Runtime behavior is still controlled by setup, enabled integrations, channels, and policy.

## Default boundaries

- Keep custom sources in connector modules.
- Keep custom messaging providers in channel plugins.
- Keep source-specific instructions in skills.
- Keep autonomy rules in policy profiles.
- Keep scoped plugin tools read-only.

Edit Murph core only when the extension point itself is missing or a behavior must ship as a built-in default.
