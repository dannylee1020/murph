---
title: Integrations
description: Connect external work sources Murph can use for context.
---

# Integrations

Integrations are connected work sources Murph can use for context while grounding replies.

Connect default integrations from setup or the local UI. Murph stores secrets in `~/.murph/.credentials` and stores non-secret local settings, such as repository scope or vault paths, in `~/.murph/config.yaml`.

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
