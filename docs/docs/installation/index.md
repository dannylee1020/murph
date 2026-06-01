---
title: Installation
description: Install Murph locally and start the server.
---

# Installation

Murph is installed as a local app plus one product-local `murph` CLI. In a Team deployment, `murph` means Murph Team. In a Personal deployment, `murph` means Murph Personal.

## Requirements

- `curl`
- Node.js 20+ and npm

If Node.js 20+ or npm is missing, the installer downloads a Murph-managed Node/npm copy under `~/.murph/deps`. It does not install Node globally or modify your system package manager. Setup helpers such as the Slack CLI are installed after Murph itself is built.

## Install from the internet

```bash
curl -fsSL https://murph-agent.com/install.sh | bash
```

For Personal:

```bash
curl -fsSL https://murph-agent.com/install-personal.sh | bash
```

By default, Murph installs Team into `~/.murph/app`, places the product-local CLI at `~/.local/bin/murph`, and keeps installer-managed helper binaries under `~/.murph/deps/bin`. Install Personal with `install-personal.sh`.

After building, the installer removes development-only payload such as CI workflows, tests, and docs-site source from `~/.murph/app`. It keeps the app source, UI source, policy profiles, runtime skills, bundled Murph Agent skill templates, themes, and setup assets so product CLI build, update, setup, and local extension work still function.

If you want to inspect the installer first:

```bash
curl -fsSL https://murph-agent.com/install.sh -o install.sh
curl -fsSL https://murph-agent.com/install-personal.sh -o install-personal.sh
bash -n install.sh
bash -n install-personal.sh
bash install.sh
bash install-personal.sh
```

## Install from a checkout

If you already have the repository:

```bash
./install.sh
./install-personal.sh
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

After rebuilding, the updater applies the same install-payload pruning as the initial installer.

## Uninstall

```bash
murph uninstall
```

This stops Murph, removes the installed Murph CLI link from `~/.local/bin`, and removes the Murph home directory at `~/.murph`. It does not delete the app directory. If the app is inside `~/.murph/app`, uninstall removes the other home-directory contents and leaves `~/.murph/app` in place. Preview first with:

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
