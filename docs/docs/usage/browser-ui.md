---
title: Browser UI
description: Use Murph from the local browser interface.
---

# Browser UI

The browser UI is the host-served visual control surface for setup, coverage sessions, status, review, and runtime control.

## Open the UI

Start Murph and print the admin dashboard URL:

```bash
murph start
murph admin url
```

Open the printed URL in the operator browser. It points at the runtime host, such as:

```text
http://localhost:5173/admin
```

The admin UI assumes the Murph host is protected by your self-hosted boundary, such as localhost, LAN, VPN, firewall, or a reverse proxy. `murph open` still opens the host UI directly.

If `5173` is occupied, stop the other process or choose a port intentionally with `MURPH_PORT=<port>`. Murph does not auto-switch ports because channel OAuth callbacks must keep matching the local origin.

## Setup wizard

Use the setup wizard to configure the AI provider, messenger channel connection, team channel defaults, and policy profile.

Changes made through setup refresh active config-bound sessions automatically. If a request is already running, Murph applies the refresh at the next run boundary.

## Status

Use status views to confirm provider setup, channel connection state, and runtime readiness before starting async coverage.

## Sessions

Use sessions when you want Murph to watch selected messenger channels during a bounded async coverage window.

The stop time is interpreted in the selected timezone and enforced by the local runtime. Murph expires the session at that workday start time, with heartbeat reconciliation as a backup if the process sleeps or restarts.

Sessions started from current config continue to track policy and setup changes. Sessions created with explicit policy or channel-scope overrides keep those explicit choices.

## Triage

Use triage after a session to review what Murph sent, queued, skipped, or failed.

## Review

Use review when policy queues a reply or a session needs human approval before sending.

## Admin dashboard

Murph has one admin dashboard for team members who operate the shared runtime. Use it to configure integrations, policy, sessions, review, triage, and runtime monitoring.

Murph does not expose per-user `/me` dashboards or member dashboard links. Keep the admin UI behind the host boundary you trust, such as localhost, LAN, VPN, firewall, or a reverse proxy.
