# Murph

Murph is a local-first coverage agent for the hours you are away.

Start a session before you log off. Murph watches the channels you choose, pulls context from your connected tools, drafts grounded replies, applies your policy, and leaves a review trail for every decision.

| What you need | What Murph does |
| --- | --- |
| Stay offline without losing momentum | Watches selected Slack or Discord channels while you are away |
| Keep control explicit | Sends safe work, queues risky work, and skips anything it should not answer |
| Use your real context | Pulls from docs, tickets, email, calendar, meetings, GitHub, and local notes |
| Review what happened | Shows what was sent, queued, skipped, and why |
| Run it yourself | Stores runtime state locally with SQLite and encrypted credentials |

```text
selected channel -> context -> grounded draft -> policy -> send | queue | skip
```

Murph is built for people who want async continuity without handing over control: indie developers, founders, operators, and distributed teams.

## Getting started

Install Murph:

```bash
curl -fsSL https://raw.githubusercontent.com/dannylee1020/murph/master/install.sh | bash
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

| Topic | Start here |
| --- | --- |
| Quickstart | [docs.murph-agent.com/docs/quickstart](https://docs.murph-agent.com/docs/quickstart) |
| Installation | [docs.murph-agent.com/docs/installation](https://docs.murph-agent.com/docs/installation) |
| Configuration | [docs.murph-agent.com/docs/configuration](https://docs.murph-agent.com/docs/configuration) |
| CLI & Agent | [docs.murph-agent.com/docs/cli-agent](https://docs.murph-agent.com/docs/cli-agent) |
| Channels | [docs.murph-agent.com/docs/channels](https://docs.murph-agent.com/docs/channels) |
| Integrations | [docs.murph-agent.com/docs/integrations](https://docs.murph-agent.com/docs/integrations) |
| Core Concepts | [docs.murph-agent.com/docs/core-concepts](https://docs.murph-agent.com/docs/core-concepts) |
| Contributing | [docs.murph-agent.com/docs/contributing](https://docs.murph-agent.com/docs/contributing) |

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
