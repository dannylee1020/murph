---
title: Installation
description: Install Murph locally and start the server.
---

# Installation

Murph is installed as a local app plus a `murph` CLI.

## Requirements

- `curl`
- Node.js 20+ and npm

If Node.js 20+ or npm is missing, the installer downloads a Murph-managed Node/npm copy under `~/.murph/deps`. It does not install Node globally or modify your system package manager. Setup helpers such as the Slack CLI are installed after Murph itself is built.

## Install from the internet

```bash
curl -fsSL https://murph-agent.com/install.sh | bash
```

By default, Murph installs into `~/.murph/app`, places the CLI at `~/.local/bin/murph`, and keeps installer-managed helper binaries under `~/.murph/deps/bin`.

After building, the installer removes development-only payload such as CI workflows, tests, and docs-site source from `~/.murph/app`. It keeps the app source, UI source, policy profiles, runtime skills, bundled Murph Agent skill templates, themes, and setup assets so `murph build`, `murph update`, setup, and local extension work still function.

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

Murph uses `http://localhost:5173` by default. If another process owns that port, startup fails clearly instead of choosing a different port, because OAuth callback URLs and tunnels depend on the exact origin. Use `MURPH_PORT=<port>` only after updating those callback URLs.

## Update

```bash
murph update
```

The updater preserves local state such as `~/.murph/config.yaml`, `~/.murph/.credentials`, and `data/`.

After rebuilding, `murph update` applies the same install-payload pruning as the initial installer.

## Uninstall

```bash
murph uninstall
```

This reverses the default local install: it stops Murph, removes `~/.murph`, removes the `murph` CLI link from `~/.local/bin`, and clears Murph-owned runtime-host credentials, logs, managed deps, and SQLite data. Preview first with:

```bash
murph uninstall --dry-run
```

For non-interactive cleanup:

```bash
murph uninstall --yes --force
```

The command does not remove system Node, Homebrew or apt packages, or unrelated helper tools.

## Check your install

```bash
murph doctor
```

If something fails, start with [Troubleshooting](/docs/installation/troubleshooting).
