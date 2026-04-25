# Nightclaw

## What It Is

Nightclaw is a self-hosted agent runtime for asynchronous work.

It helps teams keep moving when the right person is offline, unavailable, or in another timezone. Nightclaw watches selected conversations, gathers the needed context, proposes a bounded response or follow-up, and applies policy before anything is sent.

The goal is not to replace people. The goal is to preserve momentum without losing control.

## Why It Exists

Modern teams work across chat, docs, tickets, meetings, and memory. The problem is usually not a lack of information. It is that the right context is scattered, and the right person is not always available when a decision or reply is needed.

Nightclaw is built to close that gap.

With Nightclaw, teams can:

- keep conversations moving while someone is offline
- gather context from connected systems before replying
- draft bounded responses instead of making unchecked decisions
- apply clear policy before any action is taken
- review what happened through runs, audit logs, and queue history

In simple terms: Nightclaw acts as a controlled continuity layer between incoming work and the person who normally handles it.

## Getting Started

Install dependencies:

```bash
npm install
```

Create your environment file:

```bash
cp .env.example .env
```

At minimum, configure:

```bash
NIGHTCLAW_APP_URL=http://localhost:5173
NIGHTCLAW_SQLITE_PATH=data/nightclaw.sqlite
NIGHTCLAW_ENCRYPTION_KEY=replace-with-32-byte-secret
NIGHTCLAW_DEFAULT_PROVIDER=openai

OPENAI_API_KEY=
# or
ANTHROPIC_API_KEY=
```

Start the app:

```bash
npm run dev
```

By default:

- gateway: `http://localhost:5173`
- UI: `http://localhost:5174`

For local end-to-end testing, the current built-in path is:

- Slack for messaging
- OpenAI or Anthropic for model execution
- optional Notion grounding
- SQLite for local persistence

For real-world local testing setup, including Slack and Notion, see:

```text
memory/testing-guide.md
```

## Contributing

Nightclaw is designed to be extended.

Useful contribution areas include:

- new messenger adapters
- new model providers
- new tools and context sources
- new skills
- new policy profiles
- reliability, evaluation, and operator experience improvements

Before changing code, read the existing runtime shape and keep changes focused. Small, clear extensions are preferred over broad refactors.
