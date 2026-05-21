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

The schedule timezone is used when starting a session from Home. Murph computes the session stop time on the server and expires the session at the configured workday start in that timezone.

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

Use `murph setup provider` or the browser setup flow to change defaults. The CLI asks for the runtime AI provider first, then the Murph Agent model. `murph setup ai` remains as a compatibility alias. If you want the local setup/coding agent to use a different model from runtime replies, set an optional agent override:

```text
MURPH_AGENT_PROVIDER=anthropic
MURPH_AGENT_MODEL=claude-opus-4-7
```

Command flags such as `murph agent --provider openai --model gpt-5.5` still override them for one run.

Murph also runs a small no-tool policy execution classifier after the main runtime agent drafts. It uses the default runtime model unless you set an optional classifier override:

```text
MURPH_POLICY_PROVIDER=openai
MURPH_POLICY_MODEL=gpt-5.4-mini
```

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

Policy controls whether Murph sends, queues, or abstains from a drafted action. Runtime grounding is separate: it checks whether required read/context tools were attempted before Murph answers.

Built-in profiles include:

- `default`
- `engineering`
- `product`
- `sales`
- `marketing`
- `leadership`
- `yolo`

Role profiles are conservative by default and keep auto-send off. `yolo` is an explicit maximum-autonomy preset for trusted local runs; grounding still runs as a runtime obligation outside the policy gate. Use:

```bash
murph policy profiles
murph policy get
murph policy set --profile engineering
```

Use [Policy](/docs/policy) for custom profiles. Murph Agent is the preferred path for creating or changing custom policy; profile files are the fallback when you want to edit directly.

## Local health

Use the doctor check after changing configuration:

```bash
murph doctor
```
