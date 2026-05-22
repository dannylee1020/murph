---
title: Integrations
description: Connect external work sources Murph can use for context.
---

# Integrations

Integrations are connected work sources Murph can use for context while grounding replies.

## Built-in integrations

- Notion
- GitHub
- Gmail
- Google Calendar
- Granola
- Obsidian

Connect integrations from setup or the local UI.

## What integrations provide

An integration can provide:

- context sources for grounding
- read-only source search tools
- credential status for setup

Murph enables the relevant context and search capabilities when an integration is connected.

## GitHub repository scope

GitHub is intentionally narrower than a broad account search. Connecting GitHub saves a personal access token as a local credential, but GitHub retrieval stays disabled until at least one repository is selected.

From the browser UI:

1. Open Settings.
2. Connect GitHub with a personal access token.
3. Choose **Manage repositories**.
4. Select one or more `owner/repo` repositories.
5. Save the selection.

After repositories are selected, Murph can use GitHub context while grounding work:

- `github.search`
- `github.read_issue`
- `github.read_pr`

The normal setup path stores the token in `~/.murph/.credentials` and stores repository scope with the GitHub connection metadata. You can also keep repository scope in `~/.murph/config.yaml`:

```yaml
integrations:
  github:
    repositories:
      - owner/repo
      - owner/another-repo
```

Without repository scope, GitHub appears connected but asks you to choose repositories before retrieval is enabled.

For development or hosted deployments, `GITHUB_PAT` and `GITHUB_REPOSITORIES` still work as explicit runtime overrides.


## Custom integrations

Use [Plugins](/docs/plugins) when you want to add a local or custom integration without editing Murph core source.
