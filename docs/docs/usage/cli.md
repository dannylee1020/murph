---
title: CLI
description: Use the murph command-line interface.
---

# CLI

Murph installs one product-local CLI for normal use. `murph` controls the shared messenger channel runtime.

## Setup commands

```bash
murph setup
murph setup provider
murph setup slack
murph setup discord
murph setup channels
murph setup policy
murph setup status
```

Use `murph setup` on the runtime host. The wizard creates core local config, chooses the runtime AI provider, chooses a messenger provider, captures OAuth owner identity, saves channel defaults, sets the schedule, selects policy, and prints setup status.

Setup changes refresh active config-bound sessions automatically. If Murph is already handling a request, the refresh is marked pending and applied at the next run boundary.

Use `murph setup provider` to choose the runtime AI provider first, then the Murph Agent model. `murph setup ai` remains as a compatibility alias.

Use focused channel commands when only one channel area changed:

```bash
murph setup slack
murph setup discord
murph setup channels
```

`murph setup channels` saves watched-channel defaults for remote-team coverage.

`murph setup identity` remains as a compatibility check for OAuth owner identity. If identity is missing, reconnect the messenger provider; Murph does not accept a manual owner ID.

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

## Admin commands

```bash
murph admin url
```

Use `murph admin url` to print the admin dashboard URL for the current runtime host.

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
murph policy preview --profile engineering
murph policy preview --profile engineering --session-mode dry_run
murph policy set --profile engineering
murph policy set --profile yolo
```

Use policy commands to inspect or switch the local autonomy profile. New sessions inherit the selected profile's mode unless you choose a temporary session override. There is no separate durable `--mode` policy setting. For custom profiles, prefer `murph agent`; direct file editing lives in `~/.murph/policies/*.md`.

Policy changes also refresh active config-bound sessions. Sessions started with an explicit policy override keep that explicit policy.

## Maintenance commands

```bash
murph update
murph uninstall --dry-run
murph uninstall
```

Use maintenance commands from the installed product host. Uninstall removes the installed CLI link and Murph home contents only. It preserves the app directory, including the default `~/.murph/app`, and leaves unrelated system tools alone.
