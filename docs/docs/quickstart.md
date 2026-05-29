---
title: Quickstart
description: Get Murph installed, configured, and running.
---

# Quickstart

Murph is a self-hosted agent runtime for async work, built to keep teams moving across time zones without trading away control, context, or review. Run Murph Team for shared channels, or Murph Personal for private owner DMs and local data sources.

## 1. Install

Run the installer from any terminal:

```bash
curl -fsSL https://murph-agent.com/install.sh | bash
```

For Personal, use the Personal installer:

```bash
curl -fsSL https://murph-agent.com/install-personal.sh | bash
```

The installer downloads Murph, installs minimal runtime pre-reqs, builds the app, installs setup helpers such as Slack CLI, creates local defaults, and installs the product-local `murph` CLI.

## 2. Configure

Choose a product when installing, then run setup on that host:

```bash
murph setup
```

In a Team deployment, `murph setup` configures shared-channel coverage, subscribers, watched channels, schedule, and policy. In a Personal deployment, it configures owner-DM coverage for the local user and private local data sources.

## 3. Start

Start the installed runtime:

```bash
murph start
```

Murph runs at `http://localhost:5173` on the runtime host by default. If that port is already in use, Murph stops with a port-conflict message instead of switching ports automatically, because OAuth callbacks and tunnels must match the configured origin. To use another port, start Murph with `MURPH_PORT=<port>` and update any provider callback URLs to match.

To open the admin dashboard, print the URL:

```bash
murph admin url
```

## 4. Check

Run a local health check any time:

```bash
murph doctor
```

Use `murph status` to check whether the background process is running.

## Next

- [Configuration](/docs/configuration): understand provider keys, storage, policy profiles, and local health.
- [Usage](/docs/usage): use `murph`, the browser UI, and `murph agent` for setup, status, sessions, and plugin work.
- [Channels](/docs/channels): connect Slack or Discord and verify the messenger runtime.
