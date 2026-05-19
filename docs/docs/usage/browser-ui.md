---
title: Browser UI
description: Use Murph from the local browser interface.
---

# Browser UI

The browser UI is the local visual control surface for setup, sessions, status, and review.

## Open the UI

Start Murph, then open the local app:

```bash
murph start
murph open
```

Murph runs locally at:

```text
http://localhost:5173
```

## Setup wizard

Use the setup wizard to configure the AI provider, Slack connection, owner identity, watched channels, schedule, and policy profile.

## Status

Use status views to confirm provider setup, channel connection state, and runtime readiness before starting a handoff.

## Sessions

Use sessions when you want Murph to watch selected channels during a bounded offline window.

## Triage

Use triage after a session to review what Murph sent, queued, skipped, or failed.

## Review

Use review when policy queues a reply or a session needs human approval before sending.
