---
title: Integrations
description: Connect context sources and tools Murph can use while grounding work.
---

# Integrations

Integrations give Murph access to the context it needs to answer safely.

## Built-in integrations

- Notion
- GitHub
- Gmail
- Google Calendar
- Granola
- Obsidian
- Web search and fetch

Connect integrations from setup or the local UI.

## What integrations provide

An integration can provide:

- read-only tools
- context sources for grounding
- credential status for setup

Murph enables capabilities when an integration is connected, so the model can use relevant tools without a hidden second step.

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

## Web tools

`web.search` discovers public web results. Brave is the default backend; Tavily can be selected in configuration.

`web.fetch` reads an explicit `http(s)` URL and extracts readable text with a simple HTTP fetch. It is intentionally lightweight for now and does not run a browser crawler such as Crawl4AI.

The shipped providers are just defaults. Murph's integration model is meant to grow: a new web search provider, self-hosted search service, or richer fetch/extraction backend can be added behind the existing tool shape instead of changing how the runtime asks for web context.

## Custom integrations

Use [Plugins](/docs/plugins) when you want to add a local or custom integration without editing Murph core source.
