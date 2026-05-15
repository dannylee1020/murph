---
title: Installation
description: Install Murph locally and start the server.
---

# Installation

Murph is installed as a local app plus a `murph` CLI.

## Requirements

- Node.js 18 or newer
- npm
- A terminal with `curl`, `tar`, and `mktemp`
- An OpenAI or Anthropic API key

## Install from the internet

```bash
curl -fsSL https://raw.githubusercontent.com/dannylee1020/murph/master/install.sh | bash
```

By default, Murph installs into `~/.murph/app` and places the CLI at `~/.local/bin/murph`.

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
