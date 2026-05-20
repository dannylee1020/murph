---
title: Best Practices
description: Operate Murph safely during local-first handoffs.
---

# Best Practices

Use conservative defaults first, then widen Murph's scope after you have verified setup, channel access, and policy behavior.

## Start narrow

Begin with selected channels instead of all accessible channels. Expand the watched scope after a short test session.

## Verify setup

Run a local health check after changing provider keys, Slack app settings, channel scope, identity, schedule, or policy.

```bash
murph doctor
```

## Use conservative policy

Keep auto-send off until you have reviewed how Murph drafts, grounds, queues, and skips replies in your workspace.

Use `yolo` only after setup and early sessions behave the way you expect. It is intentionally permissive for action autonomy, but factual replies still need source grounding and relevant read-only tool use.

## Review triage

Check triage after each early session. Triage shows the message, context, tool calls, policy decision, and final action.

## Reconnect after scope changes

Reconnect Slack after adding app scopes or changing user-search consent. This lets Murph store fresh local credentials.

## Keep plugin work scoped

Create local extensions as scoped plugins first. Use source-edit runs only when a change must modify Murph core.
