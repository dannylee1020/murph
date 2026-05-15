# Murph

Murph is a self-hosted async autopilot for handling messaging channels while you are offline.

Start a session before you log off. Murph watches the channels you choose, pulls context from your connected tools, and handles incoming requests according to your policy. Safe work can move forward automatically; everything else is queued for review.

## What it is

Murph is built for operators who want continuity without giving up control.

It sits between your team chat and your work context: threads, docs, email, meetings, calendar, GitHub, and local notes. When something comes in, Murph gathers the relevant context, drafts a grounded response, applies your policy, and records the decision so you can audit what happened later.

## Why it helps

- **Stay offline without blocking the team** - routine questions can be answered while you are away.
- **Keep autonomy explicit** - policy profiles decide what can be sent, queued, or skipped.
- **Review with context** - morning triage shows what Murph handled and what evidence it used.
- **Connect your actual workflow** - Slack, Discord, docs, email, meetings, calendar, GitHub, and local files can all contribute context.
- **Run it yourself** - Murph stores state locally with SQLite and encrypted credentials.

## How it works

1. You start a Murph session and choose the channels to watch.
2. Murph builds a session context snapshot from your handoff notes and connected sources.
3. A message arrives in a watched channel.
4. Murph retrieves only the context relevant to that request.
5. The model drafts a response and Murph applies your policy.
6. The result is sent, queued for review, or skipped with an audit trail.

```text
channel event -> context -> skill -> grounded draft -> policy -> send | queue | skip
```

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

Detailed setup, integration, and extension docs live in `docs/`.

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
