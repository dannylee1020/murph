---
title: Integrations
description: Connect external work sources Murph can use for context.
---

# Integrations

Integrations are connected work sources Murph can use for context while grounding replies.

Connect default integrations from setup or the browser UI. Murph stores runtime-host secrets in `~/.murph/.credentials` and stores non-secret runtime-host settings, such as repository scope or vault paths, in `~/.murph/config.yaml`.

In V1, integration credentials are runtime-level credentials. In Murph Team, connected integrations are available to the shared host and should be safe for that host to read. In Murph Personal, connected integrations can point at local private sources such as Gmail, Calendar, Granola, or an Obsidian vault because the personal runtime runs on the owner's machine.

Team does not reach into individual-local private tools or files. Run Murph Personal when the context source must stay on an individual user's machine.

## Connect Default Integrations

Murph Team ships shared-source defaults: Notion, GitHub, and Linear.

Murph Personal ships the Team defaults plus personal-source defaults: Google, Granola, and Obsidian.

| Integration | How to connect | What Murph can use |
| --- | --- | --- |
| Notion | Paste a Notion integration token. | Shared pages and docs. |
| GitHub | Paste a personal access token, then select repositories. | Issues, pull requests, and repository context from selected repos. |
| Linear | Paste a Linear API key. | Issues, projects, and product work. |
| Google | Connect with Google OAuth. | Gmail threads and Google Calendar events. |
| Granola | Paste a Granola API key. | Meeting notes and transcripts. |
| Obsidian | Enter the local vault folder path. | Markdown notes in that vault. |

## What integrations provide

An integration can provide:

- context sources for grounding
- read-only source search tools
- credential status for setup

Murph enables the relevant context and search capabilities when an integration is connected.

Supported integrations may also be indexed for source-routing metadata after connection or scope changes. Team indexes GitHub, Linear, and Notion. Personal indexes those plus Granola and Obsidian. Google remains live-retrieval only for now and is not source-indexed.

## Advanced Configuration

For direct YAML and environment-variable setup, see [Configuration](/docs/configuration).

## Custom integrations

Use [Plugins](/docs/plugins) when you want to add a local or custom integration without editing Murph core source.
