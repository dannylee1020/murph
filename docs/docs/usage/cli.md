---
title: CLI
description: Use the murph command-line interface.
---

# CLI

Murph installs one product-local CLI for normal use:

- In a Team deployment, `murph` controls the shared-channel Team runtime.
- In a Personal deployment, `murph` controls the local owner-DM Personal runtime.

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

Use `murph setup` on the host where the product is installed. The wizard creates core local config, chooses the runtime AI provider, chooses Slack or Discord, captures OAuth owner identity, saves product-specific defaults, sets the schedule, selects policy, and prints setup status.

Setup changes refresh active config-bound sessions automatically. If Murph is already handling a request, the refresh is marked pending and applied at the next run boundary.

Use `murph setup provider` to choose the runtime AI provider first, then the Murph Agent model. `murph setup ai` remains as a compatibility alias.

Use focused channel commands when only one channel area changed:

```bash
murph setup slack
murph setup discord
murph setup channels
```

`murph setup channels` is Team-only. Personal setup skips watched-channel selection.

`murph setup identity` remains as a compatibility check for OAuth owner identity. If identity is missing, reconnect Slack or Discord; Murph does not accept a manual owner ID.

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

Use these commands to run Murph locally and inspect the local process. The installed product fixes the matching runtime distribution.

## Admin commands

```bash
murph admin url
murph admin subscribers
murph admin subscribers link <user-id>
murph admin subscribers revoke <user-id>
```

Use `murph admin url` to print the admin dashboard URL for the current Team runtime host.

Use `murph admin subscribers` to inspect subscriber dashboard access. Use `link` to create or regenerate a subscriber dashboard URL, and `revoke` to disable it. Personal installs are single-user and do not expose subscriber dashboard commands.

## Health commands

```bash
murph doctor
```

Use the matching product doctor after setup changes or when a channel, provider, or runtime check fails.

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

Use maintenance commands from the installed product host. Uninstall removes the installed CLI link and Murph home contents only. It preserves the app directory, including the default `~/.murph/app`, and leaves unrelated system tools alone.
