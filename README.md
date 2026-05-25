# Murph

Murph is a local-first handoff agent for the hours you are away.

Start a session before you log off. Murph watches the channels you choose, pulls context from connected integrations and tools, drafts grounded replies, applies your policy, and leaves a review trail for every decision.

| What you need | What Murph does |
| --- | --- |
| **Stay offline without losing momentum** | Watches selected messenger channels while you are away |
| **Keep control explicit** | Sends safe work, queues risky work, and skips anything it should not answer |
| **Use your real context** | Pulls from docs, tickets, email, calendar, meetings, GitHub, and local notes |
| **Review what happened** | Shows what was sent, queued, skipped, and why |
| **Run it yourself** | Stores runtime state locally with SQLite and local credentials |


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

Return to a clean local slate:

```bash
murph uninstall --dry-run
murph uninstall
```

## Documentation

| Topic | What's covered |
| --- | --- |
| [Quickstart](https://murph-agent.com/docs/quickstart) | Install Murph, run setup, start the local server, and check health. |
| [Installation](https://murph-agent.com/docs/installation) | Installer behavior, local setup, and manual install paths. |
| [Configuration](https://murph-agent.com/docs/configuration) | Provider keys, storage, policy profiles, and local runtime settings. |
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
