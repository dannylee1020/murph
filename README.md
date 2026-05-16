# Murph

Murph is a local-first handoff agent for the hours you are away.

Start a session before you log off. Murph watches the channels you choose, pulls context from your connected tools, drafts grounded replies, applies your policy, and leaves a review trail for every decision.

| What you need | What Murph does |
| --- | --- |
| **Stay offline without losing momentum** | Watches selected Slack or Discord channels while you are away |
| **Keep control explicit** | Sends safe work, queues risky work, and skips anything it should not answer |
| **Use your real context** | Pulls from docs, tickets, email, calendar, meetings, GitHub, and local notes |
| **Review what happened** | Shows what was sent, queued, skipped, and why |
| **Run it yourself** | Stores runtime state locally with SQLite and encrypted credentials |

```text
selected channel -> context -> grounded draft -> policy -> send | queue | skip
```

Murph is built for people who want async continuity without handing over control: indie developers, founders, operators, and distributed teams.

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

Check your local install any time:

```bash
murph doctor
```

## Documentation

| Topic | What's covered |
| --- | --- |
| [Quickstart](https://docs.murph-agent.com/docs/quickstart) | Install Murph, run setup, start the local server, and check health. |
| [Installation](https://docs.murph-agent.com/docs/installation) | Installer behavior, local setup, and manual install paths. |
| [Configuration](https://docs.murph-agent.com/docs/configuration) | Provider keys, storage, policy profiles, and local runtime settings. |
| [CLI & Agent](https://docs.murph-agent.com/docs/cli-agent) | `murph` commands and the local agent for setup, debugging, and plugins. |
| [Channels](https://docs.murph-agent.com/docs/channels) | Connect Slack or Discord and choose the channels Murph should watch. |
| [Integrations](https://docs.murph-agent.com/docs/integrations) | Connect context sources like docs, GitHub, Gmail, Calendar, and meetings. |
| [Core Concepts](https://docs.murph-agent.com/docs/core-concepts) | Sessions, context, skills, policy, triage, and audit trails. |
| [Contributing](https://docs.murph-agent.com/docs/contributing) | Local development, project structure, and contribution workflow. |

## Murph Agent

Murph includes a local coding agent for setup, debugging, policy changes, and scoped integration work.

```bash
murph agent
```

Use it to connect services, inspect setup issues, and create plugins without editing Murph core. By default, it can write plugin and configuration files; source edits require an explicit `--source-edits` flag.

Learn more in [CLI & Agent](https://docs.murph-agent.com/docs/cli-agent).

## What you can connect

| Category | Options |
| --- | --- |
| Channels | Slack, Discord |
| LLM providers | OpenAI, Anthropic |
| Context sources | Notion, GitHub, Gmail, Google Calendar, Granola, Obsidian |
| Runtime tools | Web search, file read, shell execution |
| Storage | Local SQLite with encrypted credentials |

## Contributing

Murph is organized around a few extension points:

- **Channels** for messaging surfaces.
- **Integrations** for external context and tools.
- **Skills** for request-specific behavior.
- **Policies** for autonomy and review rules.
- **Providers** for model backends.

For local development:

```bash
npm install
npm run dev:server
npm run dev
npm test
```

Open an issue before starting non-trivial changes.

## License

Apache 2.0
