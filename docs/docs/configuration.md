---
title: Configuration
description: Configure providers, policy, storage, and runtime defaults.
---

# Configuration

Murph stores non-secret runtime-host settings in `~/.murph/config.yaml`, runtime-host secrets in `~/.murph/.credentials`, generated memory under `app.memoryPath`, and runtime state in SQLite. Setup does not read or write `.env` files. Environment variables are an advanced override path for process control, development, and hosted deployments.

The runtime host is the machine running Murph: your laptop, a VPS, a home server, or another host you control. In V1, config, credentials, SQLite, generated memory, bot ingress, and agent execution are colocated on that host. Choose Murph Team for shared-channel coverage or Murph Personal for local owner-DM coverage.

## Setup wizard

Use the CLI setup wizard for normal configuration:

```bash
murph setup
```

Inspect runtime-host credentials with:

```bash
murph credentials doctor
```

You can re-run setup when credentials, channels, schedules, or policy choices change. The full wizard runs the same core sections as the CLI:

```text
core -> provider -> distribution role -> channel providers -> bot app setup -> owner OAuth -> channels -> schedule -> policy -> status
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

Use `murph setup slack` or `murph setup discord` inside either product install. The browser setup wizard uses the same product boundary and skips channel selection in Personal.

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

Murph uses local SQLite by default. SQLite is the transactional source of truth for sessions, runs, events, tool calls, policy decisions, action results, and runtime memory.

The SQLite path is stored in the runtime host's `~/.murph/config.yaml`:

```yaml
app:
  sqlitePath: data/murph.sqlite
```

Murph can also write generated markdown exports for operator inspection and debugging. Configure that path in the same file:

```yaml
app:
  memoryPath: ~/.murph/memory
```

Generated exports are not configuration or agent-readable runtime memory. They are rebuilt from SQLite run history and live under the configured `memoryPath`, usually as `index.md`, `threads/...`, and `sessions/...`. See [Memory](/docs/memory) for the runtime behavior.

Secrets are stored in plaintext at `~/.murph/.credentials` on the runtime host with owner-only file permissions. Runtime credential reads come from that file, not SQLite.

> **Runtime-host credential storage**
>
> Murph writes `~/.murph/.credentials` with `0600` permissions, so only the runtime-host user account can read it. For self-hosted installs, credentials are not uploaded to Murph-run servers. They only leave the runtime host when Murph uses them to call the providers you connected, such as Slack, GitHub, Google, OpenAI, or Anthropic. If you run Murph on a VPS or cloud VM, that machine is the runtime host and must be trusted with the configured credentials.

## Core runtime-host settings

Normal setup writes these values into `~/.murph/config.yaml`:

```yaml
app:
  distribution: team
  url: http://localhost:5173
  sqlitePath: data/murph.sqlite
channels:
  slack:
    eventsMode: socket
setup:
  botRoles:
    - channel
  channelProvider: slack
  channelScopeMode: selected
```

## Runtime refresh

After local config or capability changes, Murph refreshes runtime state for active sessions that inherit config. This includes policy, setup defaults, integration connections, workspace capabilities, scoped plugin reloads, channel setup, provider config, and skills.

Config-bound sessions receive the updated policy, channel scope, and runtime revision. Sessions with explicit policy or explicit channel-scope overrides keep those choices. If a request is already running, Murph marks refresh as pending and applies it at the next run boundary. See [Core Concepts](/docs/core-concepts) for the runtime model.

## Advanced process overrides

For normal setup, prefer `~/.murph/config.yaml` and `~/.murph/.credentials` on the runtime host. Environment variables are still supported when you need to control one process, point the CLI at a different runtime, isolate a test home directory, or run Murph in a hosted deployment.

Common process-control overrides:

```text
MURPH_DISTRIBUTION=team
MURPH_HOME=/path/to/murph-home
MURPH_CONFIG_PATH=/path/to/config.yaml
MURPH_CREDENTIALS_PATH=/path/to/.credentials
MURPH_URL=http://localhost:5173
MURPH_PORT=5173
```

`MURPH_URL` is the CLI control URL used by commands such as setup, status, and policy calls. `MURPH_PORT` controls the local server port when starting Murph from the CLI.

`MURPH_DISTRIBUTION=team|personal` selects the runtime distribution. Team is the default. The legacy `MURPH_PRODUCT_MODE=channel|personal` still works as a compatibility alias; `channel` maps to Team and `personal` maps to Personal unless `MURPH_DISTRIBUTION` is set.

Most runtime config keys also have environment-variable equivalents, but those should be treated as explicit overrides. If you override the local origin with `MURPH_URL`, `MURPH_PORT`, `MURPH_APP_URL`, or `DISCORD_REDIRECT_URI`, update Slack and Discord callback URLs to match before reconnecting the channel.

## Channel setup

Slack and Discord both use OAuth to lock the owner identity. Murph watches for the account that authorized the app; setup does not list workspace/server members or let you pick another owner manually.

Murph Team and Murph Personal use separate bot identities. Keep the unprefixed channel variables for Team channel-bot compatibility, or use explicit role-prefixed variables:

```bash
MURPH_DISTRIBUTION=team
MURPH_BOT_ROLES=channel

SLACK_CHANNEL_CLIENT_ID=
SLACK_CHANNEL_CLIENT_SECRET=
SLACK_CHANNEL_SIGNING_SECRET=
SLACK_CHANNEL_APP_TOKEN=

DISCORD_CHANNEL_BOT_TOKEN=
DISCORD_CHANNEL_CLIENT_ID=
DISCORD_CHANNEL_CLIENT_SECRET=
```

```bash
MURPH_DISTRIBUTION=personal
MURPH_BOT_ROLES=personal

SLACK_PERSONAL_CLIENT_ID=
SLACK_PERSONAL_CLIENT_SECRET=
SLACK_PERSONAL_SIGNING_SECRET=
SLACK_PERSONAL_APP_TOKEN=

DISCORD_PERSONAL_BOT_TOKEN=
DISCORD_PERSONAL_CLIENT_ID=
DISCORD_PERSONAL_CLIENT_SECRET=
```

The legacy `SLACK_*` and `DISCORD_*` keys still act as channel-bot defaults.

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

## Web search

Murph ships with Brave Search as the default public web discovery provider:

```yaml
integrations:
  webSearch:
    backend: brave
```

Store the Brave key through setup or the browser UI. It is saved as a runtime-host credential in `~/.murph/.credentials`.

For development or hosted deployments, `BRAVE_SEARCH_API_KEY` and `MURPH_WEB_SEARCH_BACKEND` still work as explicit runtime overrides.

`web.search` discovers candidate pages. `web.fetch` reads an explicit URL with a simple HTTP fetch and text extraction; it is intentionally not a browser crawler by default.

## Policy

Policy controls whether Murph sends, queues, or abstains from a drafted action. Runtime grounding is separate: it checks whether required read/context tools were attempted before Murph answers.

Built-in profiles include:

- `default`
- `engineering`
- `product`
- `investor`
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

Use [Policy](/docs/policy) for custom profiles. Murph Agent is the preferred path for creating or changing custom policy; direct profile files live in `~/.murph/policies/*.md`.

## Local health

Use the doctor check after changing configuration:

```bash
murph doctor
```
