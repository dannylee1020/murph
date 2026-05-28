---
title: Troubleshooting
description: Common install and local runtime problems.
---

# Troubleshooting

Start with:

```bash
murph doctor
murph status
murph logs
```

## The Murph command is not found

The installer writes the product-local `murph` command to `~/.local/bin`. Add it to your shell path:

```bash
export PATH="$HOME/.local/bin:$PATH"
```

Then restart your shell or add the line to your shell profile.

Installer-managed helper binaries, including the local Node install and Slack CLI when needed, live in `~/.murph/deps/bin`. The `murph` command adds that directory to its own runtime path.

## Murph is not built

Build from the app directory:

```bash
murph build
```

## The server is not responding

Restart the background process:

```bash
murph restart
```

Then check:

```bash
murph status
murph logs
```

## Slack redirect URI mismatch

Make sure your Slack app includes this redirect URL:

```text
http://localhost:5173/api/slack/oauth/callback
```

Socket Mode does not require a public Slack Events URL.

If you intentionally run Murph on another port with `MURPH_PORT=<port>`, update this redirect URL to use that same port.
