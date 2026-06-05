---
title: Installation
description: Install Murph locally and start the server.
---

# Installation

Murph is installed as a local app plus one product-local `murph` CLI.

## Requirements

- `curl`
- Node.js 22+ and npm

If Node.js 22+ or npm is missing, the installer downloads a Murph-managed Node/npm copy under `~/.murph/deps`. It does not install Node globally or modify your system package manager. Setup helpers such as the Slack CLI are installed after Murph itself is built.

## Install from the internet

```bash
curl -fsSL https://murph-agent.com/install.sh | bash
```

By default, Murph installs into `~/.murph/app`, places the product-local CLI at `~/.local/bin/murph`, and keeps installer-managed helper binaries under `~/.murph/deps/bin`.

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
bash -n install.sh
bash install.sh
```

## Install from a checkout

If you already have the repository:

```bash
./install.sh
```

## Remote hosting

For VPS, managed container services, Docker Compose, reverse proxies, and stable tunnel options, see [Hosting](/docs/hosting).

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

If something fails, start with the troubleshooting notes below.

## Troubleshooting

Start with:

```bash
murph doctor
murph status
murph logs
```

### The Murph command is not found

The installer writes the product-local `murph` command to `~/.local/bin`. Add it to your shell path:

```bash
export PATH="$HOME/.local/bin:$PATH"
```

Then restart your shell or add the line to your shell profile.

Installer-managed helper binaries, including the local Node install and Slack CLI when needed, live in `~/.murph/deps/bin`. The `murph` command adds that directory to its own runtime path.

### Murph is not built

Build from the app directory:

```bash
murph build
```

### The server is not responding

Restart the background process:

```bash
murph restart
```

Then check:

```bash
murph status
murph logs
```

### Slack redirect URI mismatch

Make sure your Slack app includes this redirect URL:

```text
http://localhost:5173/api/slack/oauth/callback
```

Socket Mode does not require a public Slack Events URL.

If you intentionally run Murph on another port with `MURPH_PORT=<port>`, update this redirect URL to use that same port. For remote hosts, use the stable public HTTPS origin from [Hosting](/docs/hosting).
