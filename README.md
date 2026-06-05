![Murph](./docs/public/img/social-preview-clean.png)

[![License: Apache-2.0](https://img.shields.io/badge/License-Apache--2.0-b96f22.svg)](./LICENSE)
[![Docs](https://img.shields.io/badge/docs-murph--agent.com-b96f22.svg)](https://murph-agent.com/docs)

Murph is a self-hosted agent runtime for remote teams working across time zones. Start a coverage session before someone logs off; Murph watches selected team channels, uses connected work context, and sends, queues, or skips replies based on policy.

Murph runs as one runtime on a host you control. Tools, integrations, policy, credentials, plugins, config, review, and channel coverage are shared by that runtime host so async work stays visible to the team.

Murph is not a general work assistant or enterprise search layer. It is built for one workflow: keep work moving while someone is away, then show what happened afterward.

## Getting started

The simplest download path is curl:

```bash
curl -fsSL https://murph-agent.com/install.sh | bash
murph setup
```

For a hosted Murph runtime, use Docker with a stable public URL:

```bash
MURPH_APP_URL=https://agent.example.com \
docker compose -f deploy/docker-compose.yml exec murph murph setup
```

See [Hosting](https://murph-agent.com/docs/hosting) for VPS, managed-service, tunnel, and Docker deployment details.

## Documentation

| Topic | What's covered |
| --- | --- |
| [Quickstart](https://murph-agent.com/docs/quickstart) | Install, set up, start, and check health. |
| [Installation](https://murph-agent.com/docs/installation) | Installer behavior and manual install paths. |
| [Hosting](https://murph-agent.com/docs/hosting) | Docker deployment, VPS hosting, managed services, and public URLs. |
| [Configuration](https://murph-agent.com/docs/configuration) | Provider keys, storage, policy, and runtime settings. |
| [Usage](https://murph-agent.com/docs/usage) | CLI, browser UI, sessions, review, and daily operation. |
| [Channels](https://murph-agent.com/docs/channels) | Messenger channels for remote-team coverage. |
| [Integrations](https://murph-agent.com/docs/integrations) | Shared context sources such as Notion, GitHub, Linear, and custom plugins. |
| [Plugins](https://murph-agent.com/docs/plugins) | Extend Murph with Murph Agent, plugins, skills, and read-only tools. |
| [Policy](https://murph-agent.com/docs/policy) | Autonomy and review rules. |
| [Contributing](https://murph-agent.com/docs/contributing) | Local development and contribution workflow. |

## Murph Agent

Murph Agent is the primary interface for local setup and extension work. Use it to add tools, create plugins, connect new context sources, adjust policy, and debug setup from the same host that runs Murph.

```bash
murph agent
```

Learn more in [Murph Agent](https://murph-agent.com/docs/usage/murph-agent).

## What you can connect

| Category | Options |
| --- | --- |
| Channels | Built-in messenger channels for remote-team coverage |
| LLM providers | OpenAI, Anthropic |
| Integrations | Notion, GitHub, Linear, and custom plugins |
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
