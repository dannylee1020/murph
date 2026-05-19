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
murph uninstall --dry-run
```

Use `murph uninstall` when you want to remove Murph-owned local files and return to a clean first-install state. It removes `~/.murph`, the installed CLI link, local credentials, logs, managed deps, and SQLite data, but leaves unrelated system tools alone.

## Credential commands

Murph stores local secrets in `~/.murph/.credentials`. Use the credential commands to inspect the store:

```bash
murph credentials doctor
murph credentials list
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

Choose persistent model defaults with `murph setup ai` or the browser setup flow. By default, `murph agent` inherits the runtime provider/model. Per-run flags still override those defaults:

```bash
murph agent --provider openai --model gpt-5.5
```

Use `--no-server` for offline or smoke-test sessions:

```bash
murph agent --no-server
```

## Agent write scope

By default, Murph Agent can write scoped plugin files and `~/.murph/config.yaml`, but not core Murph source files.

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

## Extending defaults

Murph Agent can update configuration and create scoped plugins when you want behavior beyond the built-in defaults. For example, you can ask it to switch web search from Brave to Tavily, add local integration configuration, or draft a scoped plugin under `~/.murph/plugins/<id>`.

When Murph Agent drafts a searchable integration, it should keep the behavior in the scoped plugin and include retrieval metadata on the adapter search tool. The usual shape is a read-only `{ query, limit }` search tool with `retrievalEligible: true` and a `retrieval.profile` matching the source.

Defaults are not hard limits. If you need another provider, ask Murph Agent to add or configure it. Provider additions that fit the plugin/config boundary should stay there; changes to core runtime tools or built-in backend code require source-edit authority.

Changing Murph core code or adding a new built-in backend still requires an explicit source-edit run:

```bash
murph agent --source-edits
```
