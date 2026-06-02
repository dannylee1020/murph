---
title: Core Concepts
description: Understand Murph's runtime, sessions, evidence, policy, memory, and review flow.
---

# Core Concepts

Murph is a self-hosted agent runtime for async work. Its core job is to receive messages, decide whether the active Team or Personal runtime should handle them, gather relevant context, draft a bounded response, and apply policy before anything is sent.

It is not an always-on chatbot. The product is built around an operator-controlled runtime host, explicit sessions, local configuration, source-grounded answers, and reviewable audit trails.

## Runtime host model

Murph runs as one of two deployable runtime distributions:

- **Murph Team** is the shared host runtime for Slack or Discord channel coverage. It owns team-level channel scope, shared tools, shared memory, queue, triage, logs, and the admin control plane.
- **Murph Personal** is a single-user local runtime for direct messages to the owner's bot identity. It owns local credentials, local memory, private data sources, queue, triage, logs, and the owner control plane.

The machine running either distribution is the Murph runtime host: it can be your laptop, a VPS, a home server, or another host you control. That host owns the runtime's config, credentials, SQLite database, generated memory, bot ingress, agent execution, integrations, policy, review, plugins, and UI.

- SQLite stores sessions, runs, events, tool calls, policy decisions, action results, and indexing state.
- `~/.murph/config.yaml` stores non-secret setup and runtime configuration on the runtime host.
- `~/.murph/.credentials` stores runtime-host secrets with owner-only permissions.
- `~/.murph/memory` stores generated markdown recall pages on the runtime host when configured through `app.memoryPath`.
- The browser UI, CLI, and Murph Agent all control the selected runtime distribution.

For a self-hosted install, credentials are not uploaded to Murph-run servers. They stay on the runtime host and only leave that host when Murph uses them to call the providers, channels, or integrations you connected. If you run Murph Team on a VPS or cloud VM, that machine must be trusted with team bot and integration credentials. If you need private local sources such as an Obsidian vault, run Murph Personal on the machine that owns those sources.

## How async work flows through Murph

The agent runtime is the center of Murph. Team turns bot-directed channel activity into policy-gated team-level actions; Personal turns owner DMs into policy-gated actions for the local owner.

At a high level, the runtime loop is:

1. A channel adapter receives a Slack, Discord, or plugin channel event.
2. The adapter normalizes the event into a task with workspace, thread, actor, session, and trigger message details.
3. Team channel events start on bot mention, then continue in already-handled threads while the active session is in scope. Personal DMs route only to the owner represented by that bot installation.
4. The gateway checks for an active session that matches the workspace, channel scope, and coverage window.
5. The runtime assembles context from the current thread, workspace memory, selected skills, and enabled integrations.
6. The tool planner decides which read-only retrieval tools are available and whether grounding is required before drafting.
7. The model drafts a proposed action such as reply, ask, redirect, defer, remind, or abstain.
8. Policy classification and deterministic policy gates decide whether the action may send, must queue for review, or should abstain.
9. Murph executes the allowed action or creates a review item.
10. Run events, tool results, policy decisions, and final outcomes are stored for triage, audit, and optional operator exports.

This is why source access, policy, and session scope matter. Murph is useful when it can answer from the current thread or connected sources and conservative when it cannot.

## Sessions

A session is a bounded async-work coverage window. You start a Team session when Murph should cover selected channels for the team, or a Personal session when Murph should cover owner DMs.

Sessions carry:

- workspace and channel scope
- start and stop time
- policy mode and selected profile
- a runtime snapshot used while handling matching tasks

Sessions started from current configuration stay config-bound. Sessions created with explicit policy or explicit channel-scope overrides keep those explicit choices.

## Runtime refresh

Murph refreshes active runtime state when local configuration or capabilities change. This keeps long-running local sessions aligned with setup changes without requiring a restart.

Refresh is triggered by changes to:

- policy profile or policy mode
- setup defaults and watched-channel config
- integration connections
- workspace capabilities
- scoped plugin reloads
- channel setup
- provider config
- runtime skills

For config-bound sessions, refresh patches the runtime snapshot with the latest policy, channel scope, and runtime revision. Explicit policy and explicit channel-scope overrides are preserved.

If a task is already running, Murph does not mutate the in-flight run. It marks refresh as pending and applies it at the next run boundary.

## Context and evidence

Murph separates context from evidence.

Context helps the agent understand the request. It can include the current thread, session metadata, workspace memory, thread memory, selected skills, and linked artifacts.

Evidence supports factual answers. It should come from current thread content, connected integration reads, or read-only tool results from the current run.

For latest, current, today, now, status, changed, or source-of-truth requests, Murph should use live retrieval from connected sources. Stored memory alone is not enough for fresh state.

## Channels, integrations, tools, and skills

Murph uses a few capability types consistently.

| Term | Meaning |
| --- | --- |
| Channels | Messaging places Murph watches and replies in, such as Slack and Discord. |
| Integrations | Connected work sources Murph can read for context. Team defaults are Notion, GitHub, and Linear. Personal also includes Google, Granola, and Obsidian. |
| Tools | Callable runtime actions, usually read-only retrieval or source access. |
| Skills | Instructions that teach Murph when and how to use a source, workflow, or evidence type. |
| Plugins | Local extension packages that add channels, integrations, tools, or skills. |

Skills are not a separate agent. They shape the runtime's behavior once relevant capabilities are available.

## Memory

Murph has one runtime memory surface and one audit log.

SQLite is the source of truth for runtime state and what happened. It preserves workspace memory, thread memory, sessions, runs, events, tools, policy, and actions.

Generated markdown is optional operator export/debug output. It is built from SQLite run history and is not agent-readable runtime memory.

See [Memory](/docs/memory) for the storage layout and freshness rules.

## Policy and review

Policy decides what Murph may do with a drafted action.

The runtime drafts first so queued work can still be useful. Then policy classification and deterministic gates decide the final outcome:

- send when policy allows a low-risk action
- queue when review is required
- abstain when Murph should not answer or cannot act safely

Policy covers autonomy, sensitive topics, blocked actions, high-risk skill contexts, and uncertainty. Grounding is related but separate: it checks whether required read/context tools were attempted before factual replies.

Use [Policy](/docs/policy) for profiles, modes, and customization.

## Triage and audit

Every run leaves an audit trail. Murph records the trigger, context assembly, selected skills, tool calls, model output, policy decision, final action, and any review item.

After a session, triage shows what Murph sent, queued, skipped, or failed. This is the operator feedback loop: review early sessions, tighten policy or channel scope, then widen autonomy only when behavior is predictable.

## Control surfaces

Murph has three control surfaces:

- [Browser UI](/docs/usage/browser-ui) for setup, sessions, status, triage, and review.
- [CLI](/docs/usage/cli) for setup, process control, health checks, credentials, and policy.
- [Murph Agent](/docs/usage/murph-agent) for guided local help with setup, debugging, policy, and scoped extension work.

All three surfaces operate on the same local configuration and runtime state for the selected distribution. Team exposes one admin dashboard for team configuration and monitoring; Personal does not expose Team admin APIs.

## Extensibility

Murph ships defaults for channels, integrations, tools, skills, policy profiles, providers, and storage, but those defaults are not a closed set.

New channels, integrations, skills, policies, model providers, search providers, and fetch backends should plug into existing extension points instead of changing the async-work runtime flow. For most local needs, start with scoped plugins under `~/.murph/plugins`.
