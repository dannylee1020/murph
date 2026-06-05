---
title: Integrations
description: Connect external work sources Murph can use for context.
---

# Integrations

Integrations are connected team work sources Murph can use for context while grounding replies.

Connect default integrations from setup or the browser UI. Murph stores runtime-host secrets in `~/.murph/.credentials` and stores non-secret runtime-host settings, such as repository scope or vault paths, in `~/.murph/config.yaml`.

Integration credentials are runtime-level credentials. Connected integrations are available to the shared host and should be safe for that host to read.

Murph does not reach into individual-local tools or files. Add only team-approved sources to the shared runtime.

## Connect Default Integrations

Murph ships shared-source defaults: Notion, GitHub, and Linear.

| Integration | How to connect | What Murph can use |
| --- | --- | --- |
| Notion | Paste a Notion integration token. | Shared pages and docs. |
| GitHub | Paste a GitHub access token, then select repositories. | Issues, pull requests, and repository context from selected repos. |
| Linear | Paste a Linear API key. | Issues, projects, and product work. |

## What integrations provide

An integration can provide:

- context sources for grounding
- read-only source search tools
- credential status for setup

Murph enables the relevant context and search capabilities when an integration is connected.

Supported integrations may also be indexed for source-routing metadata after connection or scope changes. Murph indexes GitHub, Linear, and Notion.

## Advanced Configuration

For direct YAML and environment-variable setup, see [Configuration](/docs/configuration).

## Custom integrations

Use [Plugins](/docs/plugins) when you want to add a local or custom integration without editing Murph core source.
