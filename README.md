![Murph](./docs/public/img/social-preview-clean.png)

[![CI](https://github.com/dannylee1020/murph/actions/workflows/ci.yml/badge.svg)](https://github.com/dannylee1020/murph/actions/workflows/ci.yml)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache--2.0-b96f22.svg)](./LICENSE)
[![Docs](https://img.shields.io/badge/docs-murph--agent.com-b96f22.svg)](https://murph-agent.com/docs)

Murph is a self-hosted agent runtime for async work across personal DMs and shared channels.

Run one Murph host anywhere you choose: your laptop, a VPS, a home server, or another machine you control. That host owns bot ingress, agent execution, SQLite state, generated memory, config, credentials, integrations, policy, review, plugins, and the operator UI.

Connect Slack or Discord, enable personal DM coverage, shared-channel coverage, or both, then start a session when Murph should cover async work for a represented owner. Murph pulls context from connected integrations and tools, drafts grounded replies, applies your policy, and leaves a review trail for every decision.

| What you need | What Murph does |
| --- | --- |
| **Cover async work** | Routes personal DMs and subscribed shared-channel messages through one runtime host |
| **Keep control explicit** | Sends safe work, queues risky work, and skips anything it should not answer |
| **Use your real context** | Pulls from docs, tickets, email, calendar, meetings, GitHub, and local notes |
| **Review what happened** | Shows what was sent, queued, skipped, and why |
| **Run it yourself** | Keeps runtime state, generated memory, config, and credentials on the Murph host you control |


Murph is built for people and teams that want async work covered without handing over control: indie developers, founders, operators, and distributed teams.

## Getting started

Install Murph:

```bash
curl -fsSL https://murph-agent.com/install.sh | bash
```

Run setup:

```bash
murph setup
```

Start Murph:

```bash
murph start
```

## Documentation

| Topic | What's covered |
| --- | --- |
| [Quickstart](https://murph-agent.com/docs/quickstart) | Install Murph, run setup, start the local server, and check health. |
| [Installation](https://murph-agent.com/docs/installation) | Installer behavior, local setup, and manual install paths. |
| [Configuration](https://murph-agent.com/docs/configuration) | Provider keys, storage, policy profiles, and runtime-host settings. |
| [Policy](https://murph-agent.com/docs/policy) | Create custom policy profiles with Murph Agent or local profile files. |
| [Usage](https://murph-agent.com/docs/usage) | Use `murph`, the browser UI, and `murph agent` for setup, sessions, review, and daily operation. |
| [Plugins](https://murph-agent.com/docs/plugins) | Create scoped plugins with custom integrations, skills, and read-only tools. |
| [Channels](https://murph-agent.com/docs/channels) | Connect Slack or Discord, lock owner identity through OAuth, and choose watched channels. |
| [Integrations](https://murph-agent.com/docs/integrations) | Connect context sources like docs, scoped GitHub repositories, Gmail, Calendar, and meetings. |
| [Core Concepts](https://murph-agent.com/docs/core-concepts) | Sessions, context, skills, policy, triage, and audit trails. |
| [Contributing](https://murph-agent.com/docs/contributing) | Local development, project structure, and contribution workflow. |

## Murph Agent

Murph includes a local coding agent for setup, debugging, policy changes, and scoped integration work.

```bash
murph agent
```

Use it to connect services, inspect setup issues, and create scoped plugins without editing Murph core. By default, it can write plugin and configuration files; source edits require an explicit `--source-edits` flag.

Learn more in [Murph Agent](https://murph-agent.com/docs/usage/murph-agent).

## What you can connect

| Category | Options |
| --- | --- |
| Channels | Slack, Discord + any channel of your choice |
| LLM providers | OpenAI, Anthropic |
| Integrations | Notion, GitHub, Gmail, Google Calendar, Granola, Obsidian + custom plugins |
| Tools | web search, web fetch, file read, shell + custom tools |
| Storage | SQLite + local file system|

## Contributing

Read [CONTRIBUTING.md](./CONTRIBUTING.md) before opening a pull request. Keep changes focused, include validation, and update docs for user-facing behavior.

Murph is organized around a few extension points:

- **Channels** for messaging surfaces.
- **Integrations** for connected external work sources.
- **Plugins** for local extensions.
- **Skills** for request-specific behavior.
- **Tools** for individual callable actions.
- **Policies** for autonomy and review rules.
- **Providers** for model backends.

The listed integrations and tools are defaults, not a closed set. Custom integrations and tools should start as scoped plugins before changing Murph core.

For local development:

```bash
npm install
npm run dev
npm test
```

Open an issue before starting non-trivial core/runtime changes.

## License

Apache 2.0
