---
title: Configuration
description: Configure providers, policy, storage, and runtime defaults.
---

# Configuration

Murph stores non-secret local settings in `~/.murph/config.yaml`, local secrets in `~/.murph/.credentials`, and runtime state in SQLite. Setup does not read or write `.env` files; explicit process environment variables are still supported for development and hosted runtime overrides.

## Setup wizard

Use the CLI setup wizard for normal configuration:

```bash
murph setup
```

Inspect local credentials with:

```bash
murph credentials doctor
murph credentials list
```

You can re-run setup when credentials, channels, schedules, or policy choices change.

## AI providers

Murph supports OpenAI and Anthropic. At least one provider key is required:

```text
OPENAI_API_KEY=...
ANTHROPIC_API_KEY=...
```

Runtime replies and `murph agent` share the same provider/model by default:

```text
MURPH_DEFAULT_PROVIDER=openai
MURPH_DEFAULT_MODEL=gpt-5.5
```

Use `murph setup ai` or the browser setup flow to change defaults. If you want the local setup/coding agent to use a different model from runtime replies, set an optional agent override:

```text
MURPH_AGENT_PROVIDER=anthropic
MURPH_AGENT_MODEL=claude-opus-4-7
```

Command flags such as `murph agent --provider openai --model gpt-5.5` still override them for one run.

## Storage

Murph uses local SQLite by default:

```text
MURPH_SQLITE_PATH=data/murph.sqlite
```

Secrets are stored locally in plaintext at `~/.murph/.credentials` with owner-only file permissions. Runtime credential reads come from that file or explicit environment overrides, not SQLite.

> **Local credential storage**
>
> Murph writes `~/.murph/.credentials` with `0600` permissions, so only your local user account can read it. Credentials are not uploaded to Murph servers. They only leave your machine when Murph uses them to call the providers you connected, such as Slack, GitHub, Google, OpenAI, or Anthropic.

## Web search

Murph ships with Brave Search as the default public web discovery provider:

```yaml
integrations:
  webSearch:
    backend: brave
```

Set `BRAVE_SEARCH_API_KEY` through setup or `~/.murph/.credentials`. For development and hosted deployments, an explicit `BRAVE_SEARCH_API_KEY` environment variable overrides the local credential.

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
