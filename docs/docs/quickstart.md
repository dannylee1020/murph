---
title: Quickstart
description: Get Murph installed, configured, and running.
---

# Quickstart

Murph is a local-first handoff agent for handling messaging channels while you are offline. It is extensible and flexible by design. Your choice of channels, data sources, running on your machine.

## 1. Install

Run the installer from any terminal:

```bash
curl -fsSL https://murph-agent.com/install.sh | bash
```

The installer downloads Murph, installs minimal runtime pre-reqs, builds the app, installs setup helpers such as Slack CLI, creates local defaults, and installs the `murph` CLI.

## 2. Configure

Run the setup wizard:

```bash
murph setup
```

Setup walks through the basics: AI provider, messenger credentials, identity, watched channels, schedule, and policy.

## 3. Start

Start Murph:

```bash
murph start
```

Murph runs locally at `http://localhost:5173`.

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
