---
title: Murph Agent
description: Use the local Murph Agent TUI.
---

# Murph Agent

`murph agent` opens a local TUI for setup help, debugging, policy changes, and scoped plugin work.

## Start the agent

```bash
murph agent
```

Normal runs start the local Murph server automatically so agent tools can call setup, plugin, integration, and policy APIs.

## Model selection

Choose persistent model defaults with `murph setup ai` or the browser setup flow. By default, `murph agent` inherits the runtime provider and model.

Use flags for a one-run override:

```bash
murph agent --provider openai --model gpt-5.5
```

## Offline mode

Use `--no-server` for offline or smoke-test sessions:

```bash
murph agent --no-server
```

## Write scope

By default, Murph Agent can write scoped plugin files and `~/.murph/config.yaml`, but not core Murph source files.

Use `--source-edits` only when you explicitly want the agent to edit Murph source:

```bash
murph agent --source-edits
```

## TUI commands

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
