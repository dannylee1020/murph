![Murph](./docs/public/img/social-preview-clean.png)

[![License: Apache-2.0](https://img.shields.io/badge/License-Apache--2.0-b96f22.svg)](./LICENSE)
[![Docs](https://img.shields.io/badge/docs-murph--agent.com-b96f22.svg)](https://murph-agent.com/docs)

Murph is a self-hosted agent runtime for async work. It runs on a machine you control, uses your configured context, follows your policy, and keeps review/audit history close to the runtime.

Use Murph Team for shared channels. Use Murph Personal for one person's direct messages.

| Runtime | Use it for | How it works |
| --- | --- | --- |
| **Murph Team** | Shared Slack or Discord channels | Monitors subscribed channels and routes each message to the right represented user. Tools, integrations, policy, credentials, plugins, and config are shared by the runtime host. |
| **Murph Personal** | One owner's bot DMs | Monitors direct messages to a personal bot. Tools, integrations, policy, credentials, plugins, and config belong to that single local user. |

Murph can retrieve context, draft replies, apply policy, queue risky work for review, send approved work, and show what happened afterward.

## Getting started

Install Murph Team:

```bash
curl -fsSL https://murph-agent.com/install.sh | bash
```

Install Murph Personal:

```bash
curl -fsSL https://murph-agent.com/install-personal.sh | bash
```

Then run setup and start the runtime:

```bash
murph setup
murph start
```

## Documentation

| Topic | What's covered |
| --- | --- |
| [Quickstart](https://murph-agent.com/docs/quickstart) | Install, set up, start, and check health. |
| [Installation](https://murph-agent.com/docs/installation) | Installer behavior and manual install paths. |
| [Configuration](https://murph-agent.com/docs/configuration) | Provider keys, storage, policy, and runtime settings. |
| [Usage](https://murph-agent.com/docs/usage) | CLI, browser UI, sessions, review, and daily operation. |
| [Channels](https://murph-agent.com/docs/channels) | Team watched channels and Personal bot DMs. |
| [Integrations](https://murph-agent.com/docs/integrations) | Context sources such as GitHub, Gmail, Calendar, meetings, docs, and notes. |
| [Plugins](https://murph-agent.com/docs/plugins) | Extend Murph with Murph Agent, plugins, skills, and read-only tools. |
| [Policy](https://murph-agent.com/docs/policy) | Autonomy and review rules. |
| [Contributing](https://murph-agent.com/docs/contributing) | Local development and contribution workflow. |

## Murph Agent

Murph Agent is the primary interface for extending Murph. Use it to add tools, create plugins, connect new context sources, adjust policy, and debug setup from the same host that runs the runtime.

```bash
murph agent
```

Just ask away and it shall deliver. Learn more in [Murph Agent](https://murph-agent.com/docs/usage/murph-agent).

## What you can connect

| Category | Options |
| --- | --- |
| Channels | Slack and Discord for Team channels or Personal bot DMs |
| LLM providers | OpenAI, Anthropic |
| Integrations | Notion, GitHub, Gmail, Google Calendar, Granola, Obsidian, and custom plugins |
| Tools | Web search, web fetch, file read, shell, and custom tools |
| Storage | SQLite and local files |

## Contributing

Read [CONTRIBUTING.md](./CONTRIBUTING.md) before opening a pull request. Keep changes focused, include validation, and update docs for user-facing behavior.

For local development:

```bash
npm install
npm run dev
npm test
```

Open an issue before starting non-trivial core/runtime changes.

## License

Apache 2.0
