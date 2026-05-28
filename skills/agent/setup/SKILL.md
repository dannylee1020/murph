---
name: setup
description: Diagnose Murph setup, local server, provider, integration, plugin, and policy readiness. Use when the operator asks why Murph is not working or how to configure it.
---

# Setup

Use this skill when diagnosing Murph setup.

## Workflow

1. Check server liveness with `murph_runtime_health`.
2. Check setup readiness with `murph_setup_status`.
3. Run detailed diagnostics with `murph_setup_doctor`.
4. Check integration status with `murph_integration_status`.
5. Check plugin status with `murph_plugin_status`.
6. Check selected policy with `murph_policy_get` when behavior differs from expectations.
7. Search docs with `murph_docs_search` for channel, config, provider, or setup instructions.

## Configuration Model

- Non-secret configuration belongs in `~/.murph/config.yaml`.
- Secrets belong in `~/.murph/.credentials`.
- Murph Agent can have an optional provider/model override under `ai.agent`.
- Runtime replies and Murph Agent share provider/model defaults unless an agent override is configured.

## Boundaries

- Do not ask the user to paste credentials into chat.
- Use local credential prompts or setup commands for secrets.
- Treat `--source-edits` as an explicit contributor mode, not a normal setup path.
