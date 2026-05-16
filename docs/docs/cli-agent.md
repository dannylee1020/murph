---
title: CLI & Agent
description: Use the murph CLI and the interactive Murph Agent TUI.
---

# CLI & Agent

The `murph` CLI is the local control surface for setup, runtime operations, policy, logs, and the agent.

## Core commands

```bash
murph setup
murph start
murph start --background
murph status
murph logs
murph stop
murph restart
murph doctor
murph open
murph update
```

## Policy commands

```bash
murph policy profiles
murph policy get
murph policy preview --profile engineering
murph policy set --profile engineering
```

## Murph Agent

`murph agent` opens a local TUI for setup help, debugging, policy changes, and scoped integration/plugin work.

```bash
murph agent
```

Normal runs automatically start the local Murph server so agent tools can call setup, plugin, integration, and policy APIs.

Choose persistent model defaults with `murph setup ai` or the browser setup flow. Per-run flags still override those defaults:

```bash
murph agent --provider openai --model gpt-5.4-mini
```

Use `--no-server` for offline or smoke-test sessions:

```bash
murph agent --no-server
```

## Agent write scope

By default, Murph Agent can write plugin and configuration files, but not core Murph source files.

Use `--source-edits` only when you explicitly want it to edit Murph source:

```bash
murph agent --source-edits
```

Inside the TUI:

```text
/help
/tools
/status
/tool-log on
/tool-log off
/source-edits on
/source-edits off
/quit
```

Tool logs are quiet by default. Turn them on when you need detailed debugging.
