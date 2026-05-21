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

Choose persistent model defaults with `murph setup provider` or the browser setup flow. By default, `murph agent` inherits the runtime provider and model. `murph setup ai` remains as a compatibility alias.

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

## Policy customization

Murph Agent is the preferred way to create or adjust custom policy. Ask it to inspect the current profiles, create or edit a file under `policies/`, preview the result, and select the profile.

Policy files are part of the default Plugin+Config write scope, so source-edit mode is not required for normal policy customization.

## Channel setup

Murph Agent can lead setup for built-in channels such as Slack and Discord.

For custom channels, Murph Agent can scaffold a channel plugin and guide the work, but it uses Murph's docs, setup APIs, and plugin metadata as its source of truth. A plugin-local `README.md` or `SETUP.md` can be useful maintenance documentation after the plugin exists, but it is not required for Murph Agent to begin setup.

Most messaging providers still require manual provider-console steps outside Murph, such as creating an app or bot, choosing scopes, approving access, and configuring webhooks or realtime transport.
