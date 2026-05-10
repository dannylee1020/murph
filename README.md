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

- **Default** — generic safe coverage for everyday use
- **Engineering, product, sales, marketing, leadership** — role-specific queue and abstain rules
- Shipped profiles keep auto-send off; custom profiles can opt into more autonomy later


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
9. Offer to run `murph setup --quick`

The CLI setup is the first-class setup path:

```bash
murph setup
```

It configures AI, Slack, your identity, watched channels, schedule, and policy. When setup is complete, start Murph:

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

### Setup status

Run a setup check any time:

```bash
murph setup status
murph setup status --json
murph doctor
```

You can also run individual setup sections:

```bash
murph setup ai
murph setup slack
murph setup identity
murph setup channels
murph setup schedule
murph setup policy
```

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
murph setup              # configure Murph from the CLI
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
5. Run `murph setup slack` and paste `SLACK_APP_TOKEN`, `SLACK_CLIENT_ID`, and `SLACK_CLIENT_SECRET`
6. Confirm the OAuth callback URL is registered in Slack:

```text
http://localhost:5173/api/slack/oauth/callback
```

If Slack says `redirect_uri did not match any configured URIs`, add that exact URL under **OAuth & Permissions → Redirect URLs**, then retry the install.

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

### Adding integrations

Murph integrations are adapters. First-party integrations live in provider folders:

```text
src/lib/server/integrations/github/index.ts
src/lib/server/integrations/notion/index.ts
src/lib/server/integrations/granola/index.ts
src/lib/server/integrations/google/index.ts
```

Custom integrations use the same adapter shape. An adapter can add:

- **Tools** the agent can call
- **Context sources** Murph can retrieve from during grounding
- **Session context** pulled once when a session starts
- **Credential metadata** for setup and status UI

For local/custom integrations, use either layout:

```text
~/.murph/integrations/linear.js
~/.murph/integrations/linear/index.js
```

During development, you can also use a repo-local directory:

```text
./integrations/linear.js
./integrations/linear/index.js
```

Restart Murph after adding or editing an adapter.

Minimal custom adapter:

```js
export default {
  id: 'linear',
  name: 'Linear',
  description: 'Issues and project context.',
  credential: {
    authType: 'api_key',
    credentialKind: 'api_key',
    envKey: 'LINEAR_API_KEY',
    credentialLabel: 'API key'
  },
  isConfigured() {
    return Boolean(process.env.LINEAR_API_KEY);
  },
  tools: [
    {
      name: 'linear.search',
      description: 'Search Linear issues.',
      sideEffectClass: 'read',
      optional: true,
      requiresWorkspaceEnablement: true,
      async execute(input) {
        return { results: [] };
      }
    }
  ],
  contextSources: [],
  sessionContext: {
    async contribute() {
      return { sections: [] };
    }
  }
};
```

Use a unique `id`. Built-in integrations such as `github`, `notion`, `granola`, and `google` cannot be overridden by custom adapters.


## Contributing

- **Channels** — add a messaging platform (Slack and Discord exist as references)
- **Integrations** — add a data source, tool set, or session-context contributor
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
