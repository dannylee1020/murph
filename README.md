# Murph

**Async autopilot for distributed work.**

When the people you work with are awake and you're not, every message becomes friction. You're either always-on (and burning out), or always-late (and breaking trust). The window closes before you can answer, and trust quietly erodes.

Murph is a self-hosted agent that holds the line. Start a session before you log off. It watches the channels you choose, pulls context from your tools, drafts bounded replies, and applies your policy — auto-handling what's safe, queuing what's not. You wake up to a clean queue of triaged drafts, not chaos.

Whoever's pinging you across timezones — users, teammates, contributors, customers, portfolio companies — Murph triages them while you're offline. Solo developers, founders, product managers, investors, distributed teams: if your timezone makes you miss windows, this is for you.

Built first for developers. Self-hosted, hackable, MIT.

## What it does

You start a session: *"Cover #support and #general for the next 8 hours. Manual review only."*

When a message comes in:

1. Pulls thread history, your preferences, and any linked context (docs, tickets, prior threads)
2. Selects a relevant skill and narrows the tool surface
3. Runs a grounded LLM loop with read-only tools
4. Drafts a bounded response
5. Applies your policy: auto-send if low-risk, queue for review if not
6. Logs everything — every tool call, every decision, replayable

You come back, scan the queue, approve or edit drafts in one click.

## What you get

| | |
|---|---|
| **Self-hosted** | Runs on your machine. SQLite for storage. Your data stays yours. |
| **Bring your own model** | OpenAI and Anthropic shipped. Plugin contract for more. |
| **Grounded** | Pulls from context sources before drafting — no hallucinated facts. |
| **Bounded** | Deterministic policy gate. The model never decides what's safe to send. |
| **Audit-first** | Every run, tool call, and decision is recorded and inspectable in the UI. |
| **Hackable** | Channels, tools, context sources, skills, and providers all plug in. |

## Quick start

```bash
git clone https://github.com/<you>/murph
cd murph
npm install
cp .env.example .env   # add OPENAI_API_KEY or ANTHROPIC_API_KEY
npm run dev
```

Open `http://localhost:5174` to set up your workspace and connect Slack.

Full setup guide (Slack app config, context source grounding, end-to-end testing): [`memory/testing-guide.md`](memory/testing-guide.md).

## How it works

```
Channel event
  → normalize to ContinuityTask
  → match active session
  → assemble context (thread + memory + grounding artifacts)
  → select skill, narrow tool surface
  → LLM loop (read-only tools only)
  → deterministic policy gate
  → auto_send | queue | abstain
  → audit + SSE to UI
```

Full architecture: [`memory/architecture.md`](memory/architecture.md).

## Currently shipped

- **Channels:** Slack
- **Providers:** OpenAI, Anthropic
- **Context sources:** Notion
- **Storage:** SQLite + inspectable markdown projections

The roadmap is open: Discord, WhatsApp, Telegram, Linear, GitHub, Granola, local models, and beyond.

## Contributing

Built in TypeScript, designed to extend. Best places to start:

- **Channel adapters** — Discord, Telegram, WhatsApp, Matrix, IRC
- **Context sources** — GitHub, Linear, Granola, Google Docs
- **Model providers** — local llama.cpp, Gemini, Bedrock
- **Tools** — anything an agent can safely call
- **Skills** — packaged prompts + tool combos for specific workflows
- **Policy profiles** — share trust profiles that work for your role

Read [`memory/architecture.md`](memory/architecture.md) before opening a PR. Small, focused extensions over broad refactors.

## License

MIT.
