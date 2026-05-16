---
title: Configuration
description: Configure providers, policy, storage, and runtime defaults.
---

# Configuration

Murph stores non-secret local settings in `murph.config.yaml`, secrets and deployment overrides in `.env`, and runtime state in SQLite.

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

## Web search

Murph ships with Brave Search as the default public web discovery provider:

```yaml
integrations:
  webSearch:
    backend: brave
```

Set `BRAVE_SEARCH_API_KEY` in `.env`.

Tavily is also supported out of the box:

```text
MURPH_WEB_SEARCH_BACKEND=tavily
TAVILY_API_KEY=...
```

These are defaults, not a closed provider model. Additional search providers can be added behind the same `web.search` contract when you need a different index, privacy posture, hosted provider, or self-hosted service.

`web.search` discovers candidate pages. `web.fetch` reads an explicit URL with a simple HTTP fetch and text extraction; it is intentionally not a browser crawler by default. More advanced fetch/extraction providers can be added later without changing the basic tool contract.

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
