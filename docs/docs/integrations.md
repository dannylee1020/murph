---
title: Integrations
description: Connect external work sources Murph can use for context.
---

# Integrations

Integrations are connected work sources Murph can use for context while grounding replies.

Connect default integrations from setup or the browser UI. Murph stores runtime-host secrets in `~/.murph/.credentials` and stores non-secret runtime-host settings, such as repository scope or vault paths, in `~/.murph/config.yaml`.

In V1, integration credentials are runtime-level credentials. In Murph Team, connected integrations are available to the shared host and should be safe for that host to read. In Murph Personal, connected integrations can point at local private sources such as an Obsidian vault because the personal runtime runs on the owner's machine.

Team does not reach into subscriber-local private tools or files. Run Murph Personal when the context source must stay on an individual user's machine.

## Connect Default Integrations

| Integration | How to connect | What Murph can use |
| --- | --- | --- |
| Notion | Paste a Notion integration token. | Shared pages and docs. |
| GitHub | Paste a personal access token, then select repositories. | Issues, pull requests, and repository context from selected repos. |
| Google | Connect with Google OAuth. | Gmail threads and Google Calendar events. |
| Granola | Paste a Granola API key. | Meeting notes and transcripts. |
| Obsidian | Enter the local vault folder path. | Markdown notes in that vault. |

## What integrations provide

An integration can provide:

- context sources for grounding
- read-only source search tools
- credential status for setup

Murph enables the relevant context and search capabilities when an integration is connected.

## Advanced Configuration

For direct YAML and environment-variable setup, see [Configuration](/docs/configuration).

## Custom integrations

Use [Plugins](/docs/plugins) when you want to add a local or custom integration without editing Murph core source.
