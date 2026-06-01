---
title: Connectors
description: Implement plugin-provided integrations.
---

# Connectors

For users, the public concept is an integration: a connected source Murph can use for context.

For plugin authors, a connector is the module that implements a plugin-provided integration.

For the full connector contract, credential shape, context source examples, and boundaries, use [Extending Connectors](/docs/developing/extending/connectors).

Examples:

- Jira integration implemented by a Jira connector
- internal docs integration implemented by an internal docs connector
- customer CRM integration implemented by a CRM connector

## What a connector owns

A connector owns the source identity, credential check, context sources, and tools for one plugin-provided integration.

The same metadata also drives the integration card in the browser UI after plugins are reloaded. The UI does not regenerate source code for new connectors.

## Integration module

Connector files live under `integrations/*.mjs` and are referenced by `capabilities.integrations` in `plugin.json`.

The module must export a default connector object or a named `integration` export.

```js
export default {
  id: 'jira',
  name: 'Jira',
  description: 'Jira connector',
  credential: {
    authType: 'api_key',
    credentialKind: 'api_key',
    envKey: 'JIRA_API_KEY',
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

It also describes the generic setup UI: API key, OAuth install URL, or local path. Use clear `credentialLabel` text because it is shown directly to the operator.

## Context sources

Use `contextSources` when the source can return grounding context for Murph.

## Tools

Use `tools` for specific callable actions owned by the connector.

Example: a Jira integration can expose a `jira.search` tool through its connector.

## Connector ids

Connector ids must be stable and use simple id characters: letters, numbers, dots, underscores, or hyphens.

## Safety boundary

Scoped plugin connectors can implement integrations with skills, context sources, and read-only tools. Messaging providers belong in [channel plugins](/docs/plugins/channels), not connector modules.
