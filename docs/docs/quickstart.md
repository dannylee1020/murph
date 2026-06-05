---
title: Quickstart
description: Get Murph installed, configured, and ready for async coverage.
---

# Quickstart

Murph is a self-hosted agent runtime for async coverage across time zones. Run Murph Team for shared messenger channels, or Murph Personal for direct messages and private local context.

## 1. Install

Run the installer from any terminal when you want the simplest download path:

```bash
curl -fsSL https://murph-agent.com/install.sh | bash
```

For Personal, use the Personal installer:

```bash
curl -fsSL https://murph-agent.com/install-personal.sh | bash
```

The installer downloads Murph, installs minimal runtime pre-reqs, builds the app, installs setup helpers such as Slack CLI, creates local defaults, and installs the product-local `murph` CLI.

For a Team runtime that should keep running for a remote team, deploy Murph on a VPS or managed container service. See [Hosting](/docs/hosting) for Docker, public URL, reverse proxy, tunnel, and managed-service options.

## 2. Configure

Choose a product when installing, then run setup on that host:

```bash
murph setup
```

In a Team deployment, `murph setup` configures shared messenger channel coverage, team integrations, session scope, and policy. In a Personal deployment, it configures direct-message coverage for the local user and private local data sources.

## 3. Start

Start the installed runtime:

```bash
murph start
```

Local installs run at `http://localhost:5173` on the runtime host by default. If that port is already in use, Murph stops with a port-conflict message instead of switching ports automatically, because OAuth callbacks and tunnels must match the configured origin. For hosted Team deployments, set the stable public HTTPS origin with `MURPH_APP_URL`; see [Hosting](/docs/hosting).

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
- [Hosting](/docs/hosting): deploy Murph Team on a VPS, managed container service, or stable tunnel.
- [Usage](/docs/usage): use `murph`, the browser UI, and `murph agent` for setup, status, coverage sessions, and plugin work.
- [Channels](/docs/channels): connect messenger channels and verify the runtime.
