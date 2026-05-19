---
title: Setup Flow
description: Connect messaging channels to Murph.
---

# Setup Flow

Channel setup connects a messaging workspace and saves the local defaults Murph needs for handoff sessions.

## CLI setup

Run the full setup wizard:

```bash
murph setup
```

Run channel-specific setup when only channel settings changed:

```bash
murph setup slack
murph setup channels
```

## Browser setup

Start Murph and open the local UI:

```bash
murph start
murph open
```

Use the setup wizard to connect Slack, choose owner identity, and choose watched channels.

## Local storage

Secrets are stored in `~/.murph/.credentials`. Non-secret app and workspace metadata is stored in `~/.murph/config.yaml`.

## Setup check

Run a health check after channel setup:

```bash
murph doctor
```
