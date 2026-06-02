---
title: Installation
description: Install Murph locally and start the server.
---

# Installation

Murph is installed as a local app plus one product-local `murph` CLI.

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

The internet installer downloads the current stable release archive by default, not the `main` branch. The stable installer URL stays the same, while `https://murph-agent.com/release.env` points it at the current versioned GitHub tag archive.

Pin a specific release when you need repeatable installs:

```bash
MURPH_RELEASE_VERSION=v0.1.0 bash install.sh
```

For development or testing, override the source archive explicitly:

```bash
MURPH_SOURCE_ARCHIVE=https://github.com/dannylee1020/murph/archive/refs/heads/main.tar.gz \
  bash install.sh
```

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

## Running Team and Personal on one machine

Installing both products with defaults can clash because they share `~/.murph`, `~/.murph/app`, `~/.local/bin/murph`, helper deps, credentials, logs, data paths, and port `5173`. Prefer separate machines, especially when Team uses shared credentials and Personal connects private local sources.

If one machine is required, use separate values:

| Purpose | Team | Personal |
| --- | --- | --- |
| Install dir | `MURPH_INSTALL_DIR=$HOME/.murph-team/app` | `MURPH_INSTALL_DIR=$HOME/.murph-personal/app` |
| CLI dir | `MURPH_BIN_DIR=$HOME/.local/bin/murph-team` | `MURPH_BIN_DIR=$HOME/.local/bin/murph-personal` |
| Helper deps | `MURPH_DEPS_DIR=$HOME/.murph-team/deps` | `MURPH_DEPS_DIR=$HOME/.murph-personal/deps` |
| App dir | `MURPH_APP_DIR=$HOME/.murph-team/app` | `MURPH_APP_DIR=$HOME/.murph-personal/app` |
| Home dir | `MURPH_HOME=$HOME/.murph-team` | `MURPH_HOME=$HOME/.murph-personal` |
| Config | `MURPH_CONFIG_PATH=$HOME/.murph-team/config.yaml` | `MURPH_CONFIG_PATH=$HOME/.murph-personal/config.yaml` |
| Credentials | `MURPH_CREDENTIALS_PATH=$HOME/.murph-team/.credentials` | `MURPH_CREDENTIALS_PATH=$HOME/.murph-personal/.credentials` |
| Port | `MURPH_PORT=5173` | `MURPH_PORT=5174` |

Set the install values when running each installer. Then use aliases or wrapper scripts that set the runtime values before calling each product's CLI path. Do not rely on one global `murph` command to control both installs.

If you change ports or public origins, update OAuth callback URLs before reconnecting Slack, Discord, Google, or other OAuth integrations.

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

The updater downloads the current stable release archive by default and preserves local state such as `~/.murph/config.yaml`, `~/.murph/.credentials`, and `data/`. It uses the same release pointer as the installer unless you set `MURPH_RELEASE_VERSION` for a pinned update or `MURPH_SOURCE_ARCHIVE` for a branch/custom archive.

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
