---
title: Configuration
description: Configure providers, policy, storage, and runtime defaults.
---

# Configuration

Murph stores non-secret local settings in `~/.murph/config.yaml`, local secrets in `~/.murph/.credentials`, and runtime state in SQLite. Setup does not read or write `.env` files. Environment variables are an advanced override path for process control, development, and hosted deployments.

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

You can re-run setup when credentials, channels, schedules, or policy choices change. The full wizard runs the same core sections as the CLI:

```text
core -> provider -> channel provider -> slack/discord -> identity -> channels -> schedule -> policy -> status
```

Use a focused section when only one part changed:

```bash
murph setup provider
murph setup slack
murph setup discord
murph setup channels
murph setup policy
murph setup status
```

The schedule timezone is used when starting a session from Home. Murph computes the session stop time on the server and expires the session at the configured workday start in that timezone.

## AI providers

Murph supports OpenAI and Anthropic. At least one provider key is required. Use `murph setup provider` or the browser setup flow to save provider keys into `~/.murph/.credentials`.

Runtime replies and `murph agent` share the same provider/model by default. Normal setup writes non-secret model defaults into `~/.murph/config.yaml`:

```yaml
ai:
  defaultProvider: openai
  defaultModel: gpt-5.5
```

The CLI asks for the runtime AI provider first, then the Murph Agent model. `murph setup ai` remains as a compatibility alias. If you want the local setup/coding agent to use a different model from runtime replies, save an optional agent override:

```yaml
ai:
  defaultProvider: openai
  defaultModel: gpt-5.5
  agent:
    provider: anthropic
    model: claude-opus-4-7
```

Command flags such as `murph agent --provider openai --model gpt-5.5` still override them for one run.

Murph also runs a small no-tool policy execution classifier after the main runtime agent drafts. It uses the default runtime model unless you save an optional classifier override:

```yaml
ai:
  policy:
    provider: openai
    model: gpt-5.4-mini
```

## Storage

Murph uses local SQLite by default. The path is stored in `~/.murph/config.yaml`:

```yaml
app:
  sqlitePath: data/murph.sqlite
```

Secrets are stored locally in plaintext at `~/.murph/.credentials` with owner-only file permissions. Runtime credential reads come from that file, not SQLite.

> **Local credential storage**
>
> Murph writes `~/.murph/.credentials` with `0600` permissions, so only your local user account can read it. Credentials are not uploaded to Murph servers. They only leave your machine when Murph uses them to call the providers you connected, such as Slack, GitHub, Google, OpenAI, or Anthropic.

## Core local settings

Normal setup writes these values into `~/.murph/config.yaml`:

```yaml
app:
  url: http://localhost:5173
  sqlitePath: data/murph.sqlite
channels:
  slack:
    eventsMode: socket
setup:
  channelProvider: slack
  channelScopeMode: selected
```

## Advanced process overrides

For local setup, prefer `~/.murph/config.yaml` and `~/.murph/.credentials`. Environment variables are still supported when you need to control one process, point the CLI at a different local server, isolate a test home directory, or run Murph in a hosted deployment.

Common process-control overrides:

```text
MURPH_HOME=/path/to/murph-home
MURPH_CONFIG_PATH=/path/to/config.yaml
MURPH_CREDENTIALS_PATH=/path/to/.credentials
MURPH_URL=http://localhost:5173
MURPH_PORT=5173
```

`MURPH_URL` is the CLI control URL used by commands such as setup, status, and policy calls. `MURPH_PORT` controls the local server port when starting Murph from the CLI.

Most runtime config keys also have environment-variable equivalents, but those should be treated as explicit overrides. If you override the local origin with `MURPH_URL`, `MURPH_PORT`, `MURPH_APP_URL`, or `DISCORD_REDIRECT_URI`, update Slack and Discord callback URLs to match before reconnecting the channel.

## Channel setup

Slack and Discord both use OAuth to lock the owner identity. Murph watches for the account that authorized the app; setup does not list workspace/server members or let you pick another owner manually.

Channel defaults live under `setup` in `~/.murph/config.yaml`. The important fields are:

```yaml
setup:
  channelProvider: slack
  workspaceId: workspace-id
  workspaceOwners:
    - workspaceId: workspace-id
      ownerUserId: provider-user-id
      ownerDisplayName: Your Name
  channelScopeMode: selected
  selectedChannels:
    - id: C123
      displayName: "#support"
```

Use `channelScopeMode: all_accessible` only after you have verified the app or bot can safely read every channel it can access.

## GitHub scope

GitHub retrieval is disabled until a repository scope is selected. The browser UI stores the GitHub token in `~/.murph/.credentials` and writes selected repositories into local setup metadata. You can also keep the repository scope in `~/.murph/config.yaml`:

```yaml
integrations:
  github:
    repositories:
      - owner/repo
      - owner/another-repo
```

The token itself remains a secret and belongs in `~/.murph/.credentials`, not `config.yaml`.

For development or hosted deployments, `GITHUB_PAT` and `GITHUB_REPOSITORIES` still work as explicit runtime overrides.

## Web search

Murph ships with Brave Search as the default public web discovery provider:

```yaml
integrations:
  webSearch:
    backend: brave
```

Store the Brave key through setup or the browser UI. It is saved as a local credential in `~/.murph/.credentials`.

Tavily is also supported out of the box:

```yaml
integrations:
  webSearch:
    backend: tavily
```

Store the Tavily key in `~/.murph/.credentials`. For development or hosted deployments, `BRAVE_SEARCH_API_KEY`, `TAVILY_API_KEY`, and `MURPH_WEB_SEARCH_BACKEND` still work as explicit runtime overrides.

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
murph policy set --mode manual_review
```

The durable policy default is stored in `~/.murph/config.yaml`:

```yaml
policy:
  profile: engineering
  mode: manual_review
```

New sessions inherit `policy.mode` by default. Use a session-level mode only for a temporary override such as dry-run or review-everything testing.

Use [Policy](/docs/policy) for custom profiles. Murph Agent is the preferred path for creating or changing custom policy; profile files are the fallback when you want to edit directly.

## Local health

Use the doctor check after changing configuration:

```bash
murph doctor
```
