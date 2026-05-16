---
title: Configuration
description: Configure providers, policy, storage, and runtime defaults.
---

# Configuration

Murph stores local configuration in `.env` and runtime state in SQLite.

## Setup wizard

Use the CLI setup wizard for normal configuration:

```bash
murph setup
```

You can re-run setup when credentials, channels, schedules, or policy choices change.

## AI providers

Murph supports OpenAI and Anthropic. At least one provider key is required:

```text
OPENAI_API_KEY=...
ANTHROPIC_API_KEY=...
```

`murph agent` uses the same provider keys, but its provider and model can be set independently:

```text
MURPH_AGENT_PROVIDER=openai
MURPH_AGENT_MODEL=gpt-5.4-mini
```

Use `murph setup ai` or the browser setup flow to change these defaults. Command flags such as `murph agent --provider anthropic --model claude-sonnet-4-6` still override them for one run.

## Storage

Murph uses local SQLite by default:

```text
MURPH_SQLITE_PATH=data/murph.sqlite
```

Credentials are encrypted locally with `MURPH_ENCRYPTION_KEY`.

## Policy

Policy controls how much autonomy Murph has.

Built-in profiles include:

- `default`
- `engineering`
- `product`
- `sales`
- `marketing`
- `leadership`

Built-in profiles are conservative by default and keep auto-send off. Use:

```bash
murph policy profiles
murph policy get
murph policy set --profile engineering
```

## Local health

Use the doctor check after changing configuration:

```bash
murph doctor
```
