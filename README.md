# Murph

A self-hosted async autopilot that handles your messaging channels while you're offline.

**Goal:** Remove timezone as a productivity bottleneck. Murph handles your channels while you're away — triaging, drafting, and responding so nothing waits until you're back.

Start a session before you log off. Murph watches the channels you choose, pulls context, and handles requests grounded to your policy - executing what's safe, queueing the rest for review. Teams get unblocked and you start the morning with clean todo.


## How it works

1. A message comes in on a watched channel
2. Murph pulls thread history, your preferences, and linked context (docs, tickets, prior threads)
3. Selects a skill, narrows the tool surface, runs a grounded LLM loop
4. Applies your policy: execute and send if low-risk, queue for review if not
5. Logs every tool call and decision

```
Channel event → normalize → match session → assemble context
  → select skill → LLM loop (read-only tools) → policy gate
  → auto_send | queue | abstain → audit + SSE to UI
```

## Quick start

```bash
git clone https://github.com/<you>/murph
cd murph
npm install
cp .env.example .env   # add OPENAI_API_KEY or ANTHROPIC_API_KEY
npm run dev
```

Open `http://localhost:5174` to connect Slack and start a session.

## What's included

- **Channels:** Slack, Discord
- **Providers:** OpenAI, Anthropic
- **Context sources:** Notion, GitHub, Gmail, Google Calendar, Granola, Obsidian
- **Tools:** Web search, file read, shell exec
- **Storage:** SQLite with encrypted credentials


## Contributing
- **Channels** — add a messaging platform (Slack and Discord exist as references)
- **Context sources** — connect a new data source (Notion, GitHub, Gmail, etc.)
- **Tools** — give the agent new capabilities
- **Skills** — define how the agent handles specific types of requests
- **Providers** — plug in a different LLM

```bash
npm install
npm run dev        # starts server + UI
npm test           # run tests
```

Open an issue first for anything non-trivial. PRs welcome.

## License

Apache 2.0
