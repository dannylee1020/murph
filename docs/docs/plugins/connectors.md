---
title: Connectors
description: Implement plugin-provided integrations.
---

# Connectors

For users, the public concept is an integration: a connected source Murph can use for context.

For plugin authors, a connector is the module that implements a plugin-provided integration.

Examples:

- Linear integration implemented by a Linear connector
- internal docs integration implemented by an internal docs connector
- customer CRM integration implemented by a CRM connector

## What a connector owns

A connector owns the source identity, credential check, context sources, and tools for one plugin-provided integration.

## Integration module

Connector files live under `integrations/*.mjs` and are referenced by `capabilities.integrations` in `plugin.json`.

The module must export a default connector object or a named `integration` export.

```js
export default {
  id: 'linear',
  name: 'Linear',
  description: 'Linear connector',
  credential: {
    authType: 'api_key',
    credentialKind: 'api_key',
    envKey: 'LINEAR_API_KEY',
    credentialLabel: 'API key'
  },
  tools: [],
  contextSources: [],
  isConfigured() {
    return false;
  }
};
```

## Credentials

The `credential` block describes how Murph checks whether the source is configured.

## Context sources

Use `contextSources` when the source can return grounding context for Murph.

## Tools

Use `tools` for specific callable actions owned by the connector.

Example: a Linear integration can expose a `linear.search` tool through its connector.

## Connector ids

Connector ids must be stable and use simple id characters: letters, numbers, dots, underscores, or hyphens.

## Safety boundary

Scoped plugin connectors can implement integrations with skills, context sources, and read-only tools. Messaging providers belong in [channel plugins](/docs/plugins/channels), not connector modules.
