---
title: Extending Tools
description: Define read-only plugin tools Murph can call for grounded work.
---

# Extending Tools

A tool is one callable action Murph can run while working on a task.

Plugin-provided tools must be read-only. Use tools for source search, lookup, fetch, and lightweight analysis. Do not use scoped plugin tools for write side effects.

## Tool definition

A tool follows `ToolDefinition`:

```ts
{
  name: string;
  description: string;
  sideEffectClass: 'read' | 'write' | 'external_write';
  inputSchema?: Record<string, unknown>;
  knowledgeDomains?: string[];
  retrievalEligible?: boolean;
  retrieval?: { profile?: string; queryHints?: Record<string, unknown> };
  optional?: boolean;
  sessionModes?: Array<'dry_run' | 'manual_review' | 'auto_send_low_risk'>;
  requiresWorkspaceEnablement?: boolean;
  supportsDryRun?: boolean;
  execute(input, context): Promise<unknown>;
}
```

For scoped plugins, `sideEffectClass` must be `read`.

## Naming

Use source-prefixed names:

```text
linear.search
linear.read_issue
docs.search
crm.find_account
```

Names appear in traces, retrieval plans, and error messages. Keep them stable after users enable them.

## Input schema

Use a JSON-schema-like object with explicit required fields:

```js
inputSchema: {
  type: 'object',
  additionalProperties: false,
  required: ['query'],
  properties: {
    query: { type: 'string' },
    limit: { type: 'number' }
  }
}
```

Murph passes tool input from the model, so schemas should be small and unambiguous.

## Retrieval eligibility

Set `retrievalEligible: true` only when Murph may call the tool during retrieval before drafting.

Use a retrieval profile that matches the source:

```js
retrievalEligible: true,
retrieval: { profile: 'work_item' }
```

Common profiles:

- `title_keywords`
- `work_item`
- `code_review`
- `email_thread`
- `team_discussion`
- `generic`

## Workspace enablement

Use `requiresWorkspaceEnablement: true` for optional tools that should only run after the workspace enables them.

Use `optional: true` when the tool is not required for core runtime behavior.

## Example

```js
export const linearSearchTool = {
  name: 'linear.search',
  description: 'Search Linear issues by query text.',
  sideEffectClass: 'read',
  retrievalEligible: true,
  retrieval: { profile: 'work_item' },
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['query'],
    properties: {
      query: { type: 'string' },
      limit: { type: 'number' }
    }
  },
  knowledgeDomains: ['work_item'],
  optional: true,
  requiresWorkspaceEnablement: true,
  supportsDryRun: true,
  async execute(input, context) {
    const limit = input.limit ?? 5;
    return await searchLinear(input.query, limit, context.workspace.id);
  }
};
```

Connector modules usually expose tools through their integration descriptor instead of manually registering them.

