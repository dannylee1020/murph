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
murph setup identity
murph setup channels
murph setup schedule
murph setup policy
murph setup status
```

Use `murph setup` for the full wizard. Use `murph setup provider` to choose the runtime AI provider first, then the Murph Agent model. `murph setup ai` remains as a compatibility alias.

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

Murph stores local secrets in `~/.murph/.credentials`.

```bash
murph credentials doctor
murph credentials list
```

Use these commands to inspect local credential readiness without printing secret values.

## Policy commands

```bash
murph policy profiles
murph policy get
murph policy preview --profile engineering
murph policy set --profile engineering
murph policy set --profile yolo
```

Use policy commands to inspect or switch the local autonomy profile. For custom profiles, prefer `murph agent`; direct file editing lives in `policies/*.md`.

## Maintenance commands

```bash
murph update
murph uninstall --dry-run
murph uninstall
```

Use `murph uninstall --dry-run` before removing Murph-owned local files. `murph uninstall` removes `~/.murph`, the installed CLI link, local credentials, logs, managed deps, and SQLite data, but leaves unrelated system tools alone.
