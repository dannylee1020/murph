---
title: Connectors
description: Add external sources to scoped plugins.
---

# Connectors

A connector is the plugin module for one outside source.

Examples:

- Linear connector
- internal docs connector
- customer CRM connector

## What a connector owns

A connector owns the source identity, credential check, context sources, and tools for one integration.

## Adapter module

Connector files live under `adapters/*.mjs` because the runtime calls them integration adapters.

An adapter module must export a default adapter or a named `adapter` export.

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

Example: a Linear connector can expose a `linear.search` tool.

## Connector ids

Connector ids must be stable and use simple id characters: letters, numbers, dots, underscores, or hyphens.

## Safety boundary

Scoped plugin connectors can add skills, context sources, and read-only tools. They cannot register messaging channels or model providers through the scoped plugin loader.
