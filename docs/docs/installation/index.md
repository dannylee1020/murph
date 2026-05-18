---
title: Installation
description: Install Murph locally and start the server.
---

# Installation

Murph is installed as a local app plus a `murph` CLI.

## Requirements

- A terminal with `curl`, `tar`, `mktemp`, and `uname`
- An OpenAI or Anthropic API key

The installer checks the minimal runtime pre-reqs first. If Node.js 20+ and npm are not available, it installs Node locally under `~/.murph/deps`. Setup helpers such as the Slack CLI are installed after Murph itself is built.

## Install from the internet

```bash
curl -fsSL https://murph-agent.com/install.sh | bash
```

By default, Murph installs into `~/.murph/app` and places the CLI at `~/.local/bin/murph`.

If you want to inspect the installer first:

```bash
curl -fsSL https://murph-agent.com/install.sh -o install.sh
bash -n install.sh
bash install.sh
```

## Install from a checkout

If you already have the repository:

```bash
./install.sh
```

## Start and stop

```bash
murph start
murph status
murph stop
murph restart
```

Use `murph start --background` when you want Murph to keep running after the terminal closes.

## Update

```bash
murph update
```

The updater preserves local state such as `.env` and `data/`.

## Check your install

```bash
murph doctor
```

If something fails, start with [Troubleshooting](/docs/installation/troubleshooting).
