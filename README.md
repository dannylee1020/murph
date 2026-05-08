# Murph

A self-hosted async autopilot that handles your messaging channels while you're offline.

Start a session before you log off. Murph watches the channels you choose, pulls relevant context from your connected tools, and handles incoming requests — sending safe responses automatically and queuing the rest for your review. Teams get unblocked and you start the morning with a clean inbox.


## How it works

1. A message arrives on a watched channel
2. Murph assembles context — thread history, your preferences, and linked sources (docs, email, meeting notes, calendar)
3. Picks the right skill for the request and retrieves only the sources that are relevant
4. Runs a grounded LLM loop, then applies your policy: send if low-risk, queue if not
5. Logs every tool call and decision for full auditability

```
Channel event → normalize → match session → assemble context
  → select skill → LLM loop → policy gate
  → auto_send | queue | abstain → audit + SSE to UI
```

### Sessions and context

When you start a session, Murph builds a **session context snapshot** — a one-time pull of your handoff notes and today's relevant data from connected sources. This gives every action during the session a shared baseline without re-fetching on every message.

After a session ends, the **triage view** shows what Murph handled, what it queued, and what it skipped, along with the context snapshot behind each decision so you can review with full transparency.

### Skills

Skills define how Murph handles different types of requests. Each skill declares which knowledge domains it needs (email, calendar, documentation, meetings) so context retrieval stays focused. Built-in skills cover:

- **Channel continuity** — general thread follow-ups
- **Communication** — email, scheduling, and follow-up questions
- **Meeting** — questions about what was said or decided in meetings
- **Documentation** — fact-finding from shared docs and code
- **Morning digest** — a scheduled summary of overnight activity

### Policy

You control how much autonomy Murph has through policy profiles:

- **Auto-send low-risk** — send safe responses, queue everything else
- **Manual review** — queue all drafts for your approval
- Per-user overrides for confidence thresholds and allowed action types


## Installation

Run the installer from any terminal.

```bash
curl -fsSL https://raw.githubusercontent.com/dannylee1020/murph/master/install.sh | bash
```

The installer will:

1. Check that Node.js 18+ and npm are available
2. Download Murph into `~/.murph/app`
3. Install dependencies
4. Build the server and UI
5. Create `.env` with local defaults and a generated encryption key
6. Create the local SQLite data directory
7. Prompt for an OpenAI or Anthropic API key
8. Install the `murph` CLI into `~/.local/bin`
9. Offer to start Murph

Open:

```text
http://localhost:5173/setup
```

If you skip startup, run:

```bash
murph start
```

To install somewhere else:

```bash
curl -fsSL https://raw.githubusercontent.com/dannylee1020/murph/master/install.sh | MURPH_INSTALL_DIR=/path/to/murph bash
```

Run a local setup check any time:

```bash
murph doctor
```

### Simple setup

Use this if you want minimal terminal interaction and browser-based setup.

```bash
curl -fsSL https://raw.githubusercontent.com/dannylee1020/murph/master/install.sh | bash -s -- --simple
```

This runs the same install flow, but skips API-key prompts. After startup, open `http://localhost:5173/setup` and finish setup in the browser.

The browser setup asks for:

1. OpenAI or Anthropic API key
2. Slack app credentials
3. Slack workspace connection
4. Your Slack identity
5. Channels Murph should watch
6. Your work schedule

Useful installer flags:

```bash
curl -fsSL https://raw.githubusercontent.com/dannylee1020/murph/master/install.sh | bash -s -- --simple
curl -fsSL https://raw.githubusercontent.com/dannylee1020/murph/master/install.sh | bash -s -- --no-start
curl -fsSL https://raw.githubusercontent.com/dannylee1020/murph/master/install.sh | bash -s -- --skip-build
curl -fsSL https://raw.githubusercontent.com/dannylee1020/murph/master/install.sh | bash -s -- --force
curl -fsSL https://raw.githubusercontent.com/dannylee1020/murph/master/install.sh | bash -s -- --doctor
```

If you already have a Murph checkout, run `./install.sh` from that directory.

### Day-to-day commands

```bash
murph start              # start in the foreground
murph start --background # start in the background
murph status             # check process and health
murph logs -f            # follow logs
murph stop               # stop the background process
murph restart            # restart in the background
murph doctor             # check local setup
murph open               # open the setup page
murph update             # update the installed app
```

If your shell cannot find `murph`, add the user-local bin directory to your PATH:

```bash
export PATH="$HOME/.local/bin:$PATH"
```

### Slack app setup

Slack uses Socket Mode by default.

1. Create a Slack app at `https://api.slack.com/apps`
2. Use `docs/slack-socket-mode-manifest.yml` as the app manifest
3. Enable Socket Mode
4. Create an app-level token with `connections:write`
5. Add `SLACK_APP_TOKEN`, `SLACK_CLIENT_ID`, and `SLACK_CLIENT_SECRET` in `.env` or browser setup
6. Set the OAuth callback URL to:

```text
http://localhost:5173/api/slack/oauth/callback
```

No Slack Events URL is needed when `SLACK_EVENTS_MODE=socket`.

### Manual setup

Use this path if you do not want to run the installer.

```bash
npm install
cp .env.example .env   # add OPENAI_API_KEY or ANTHROPIC_API_KEY
npm run build
npm start
```

For development, run the API server and UI separately:

```bash
npm run dev:server
npm run dev
```

The production server runs on `http://localhost:5173`. The Vite dev UI usually runs on `http://localhost:5174`.

### What you can connect

| Category | Options |
|---|---|
| **Channels** | Slack, Discord |
| **LLM providers** | OpenAI, Anthropic |
| **Context sources** | Notion, GitHub, Gmail, Google Calendar, Granola, Obsidian |
| **Built-in tools** | Web search, file read, shell exec |
| **Storage** | SQLite with encrypted credentials |

Integrations are configured per-workspace from the settings page.


## Contributing

- **Channels** — add a messaging platform (Slack and Discord exist as references)
- **Context sources** — connect a new data source (Notion, GitHub, Gmail, etc.)
- **Tools** — give the agent new capabilities
- **Skills** — define how the agent handles specific types of requests
- **Providers** — plug in a different LLM

```bash
npm install
npm run dev:server # starts the API server
npm run dev        # starts the UI
npm test           # run tests
```

Open an issue first for anything non-trivial. PRs welcome.

## License

Apache 2.0
