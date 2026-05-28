---
name: channel
description: Create or update Murph channel plugins for custom messaging providers. Use when the operator asks to add Slack or Discord style channel support outside Murph core.
---

# Channel

Use this skill for custom messaging providers.

## Workflow

1. Search channel docs with `murph_docs_search`.
2. Search current source and docs with `murph_architecture_search` for channel runtime boundaries.
3. Create channel plugins under `~/.murph/plugins/channels/<id>`.
4. Prefer `murph_plugin_create_draft` with category `channels`.
5. Implement the channel plugin contract: `runtime`, `setup`, and optional `ingress`.
6. Validate and reload through Murph plugin tools.

## Contract Notes

- `runtime.normalizeEvent` converts provider events into Murph tasks.
- `runtime.fetchThread` returns normalized thread messages.
- `runtime.postReply` sends approved replies to the provider.
- `setup` exposes provider readiness, members, and channels for setup UI/API surfaces.
- `ingress` handles webhooks when the provider uses HTTP ingress.

## Boundaries

- Built-in Slack and Discord are core channels; custom providers should start as scoped channel plugins.
- Provider console work still happens outside Murph: apps, bots, scopes, redirect URLs, webhooks, and approvals.
- Do not edit core channel runtime files unless the operator explicitly asks for source edits.
