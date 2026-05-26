---
title: CLI
description: Use the murph command-line interface.
---

# CLI

The `murph` CLI is the terminal control surface for setup, runtime operations, health checks, credentials, and policy.

## Setup commands

```bash
murph setup
murph setup provider
murph setup ai
murph setup slack
murph setup discord
murph setup identity
murph setup channels
murph setup schedule
murph setup policy
murph setup status
```

Use `murph setup` for the full wizard. The wizard creates core local config, chooses the runtime AI provider, chooses Slack or Discord, captures your OAuth owner identity, saves watched-channel defaults, sets the schedule, selects policy, and prints setup status.

Setup changes refresh active config-bound sessions automatically. If Murph is already handling a request, the refresh is marked pending and applied at the next run boundary.

Use `murph setup provider` to choose the runtime AI provider first, then the Murph Agent model. `murph setup ai` remains as a compatibility alias.

Use focused channel commands when only one channel area changed:

```bash
murph setup slack
murph setup discord
murph setup channels
```

`murph setup identity` only verifies that OAuth owner identity is present. If it is missing, reconnect Slack or Discord; Murph does not accept a manual owner ID.

## Runtime commands

```bash
murph start
murph start --background
murph status
murph logs
murph stop
murph restart
murph open
```

Use these commands to run Murph locally and inspect the local process.

## Health commands

```bash
murph doctor
```

Use `murph doctor` after setup changes or when a channel, provider, or runtime check fails.

## Credential commands

Murph stores runtime-host secrets in `~/.murph/.credentials`.

```bash
murph credentials doctor
murph credentials list
```

Use these commands to inspect runtime-host credential readiness without printing secret values.

## Policy commands

```bash
murph policy profiles
murph policy get
murph policy preview --profile engineering --mode manual_review
murph policy set --profile engineering
murph policy set --mode auto_send_low_risk
murph policy set --profile yolo
```

Use policy commands to inspect or switch the local autonomy profile and default execution mode. New sessions inherit policy mode unless you choose a temporary session override. For custom profiles, prefer `murph agent`; direct file editing lives in `~/.murph/policies/*.md`.

Policy changes also refresh active config-bound sessions. Sessions started with an explicit policy override keep that explicit policy.

## Maintenance commands

```bash
murph update
murph uninstall --dry-run
murph uninstall
```

Use `murph uninstall --dry-run` before removing Murph-owned local files. `murph uninstall` removes `~/.murph`, the installed CLI link, runtime-host credentials, logs, managed deps, and SQLite data, but leaves unrelated system tools alone.
