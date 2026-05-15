---
title: Quickstart
description: Get Murph installed, configured, and running.
---

# Quickstart

Murph is a self-hosted async autopilot for handling messaging channels while you are offline.

::: info Local first
Murph runs on your machine. Start the server, connect your channels, and use the doctor command whenever setup feels off.
:::

## 1. Install

Run the installer from any terminal:

```bash
curl -fsSL https://raw.githubusercontent.com/dannylee1020/murph/master/install.sh | bash
```

The installer downloads Murph, installs dependencies, builds the app, creates local defaults, and installs the `murph` CLI.

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
- [CLI & Agent](/docs/cli-agent): use `murph` and `murph agent` for setup, status, and plugin work.
- [Channels](/docs/channels): connect Slack or Discord and verify the messenger runtime.
