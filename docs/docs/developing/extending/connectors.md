---
title: Extending Connectors
description: Implement plugin-provided integrations, context sources, and source-owned tools.
---

# Extending Connectors

A connector is the module that implements a plugin-provided integration.

Use a connector when Murph should connect to a private source, check credentials, retrieve context, and expose read-only source tools.

After plugin reload, connector metadata is exposed through `/api/integrations/status`. The browser UI renders integration cards from that runtime response instead of generating new frontend code for each connector.

## Module export

Connector modules live under `integrations/*.mjs` and are referenced by `capabilities.integrations` in `plugin.json`.

Export a default integration object or a named `integration` export:

```js
export default {
  id: 'jira',
  name: 'Jira',
  description: 'Jira issue and project context.',
  credential: {
    authType: 'api_key',
    credentialKind: 'api_key',
    envKey: 'JIRA_API_KEY',
    credentialLabel: 'API key'
  },
  contextSources: [],
  tools: [],
  isConfigured() {
    return Boolean(process.env.JIRA_API_KEY);
  }
};
```

## Credential block

The credential block describes how setup and status surfaces identify the connection:

| Field | Purpose |
| --- | --- |
| `authType` | Connection UX type, such as API key, OAuth, or local path. |
| `credentialKind` | Stored credential category: `api_key`, `oauth_bundle`, or `config_path`. |
| `envKey` | Environment or credential key Murph checks. |
| `credentialLabel` | Human label shown in setup UI. |
| `installPath` | Optional source-specific setup URL or path. |

`isConfigured(workspaceId)` should return `true` only when the source can actually be used.

Keep connector metadata complete and operator-facing. The generic integration card uses `name`, `description`, `credentialLabel`, `tools`, and `contextSources` directly.

## Context sources

Use context sources when a source can add grounding artifacts before Murph drafts:

```js
contextSources: [
  {
    name: 'jira.thread_search',
    description: 'Search Jira issues from the current thread text.',
    optional: true,
    knowledgeDomains: ['work_item'],
    async retrieve(input) {
      const results = await searchJiraFromThread(input.task, input.workspace.id);
      return results.map((issue) => ({
        id: issue.id,
        source: 'jira',
        type: 'issue',
        title: issue.title,
        text: issue.summary,
        url: issue.url
      }));
    }
  }
]
```

Artifacts should be concise and source-bearing. Include URLs when the source has stable URLs.

## Source-owned tools

Use tools for explicit model calls such as search, read, lookup, or fetch:

```js
tools: [
  {
    name: 'jira.read_issue',
    description: 'Read a Jira issue by identifier.',
    sideEffectClass: 'read',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['id'],
      properties: { id: { type: 'string' } }
    },
    supportsDryRun: true,
    async execute(input, context) {
      return await readJiraIssue(input.id, context.workspace.id);
    }
  }
]
```

Scoped plugin connector tools must be read-only.

## Connector boundaries

- Use connectors for integrations and source-owned read tools.
- Use channel plugins for messaging providers and ingress.
- Use skills for instructions about how to use the connector.
- Use policy for autonomy and review rules.

The scoped plugin loader rejects connector modules that try to contribute channel adapters or model providers.
