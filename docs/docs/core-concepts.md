---
title: Core Concepts
description: Understand Murph's runtime, sessions, evidence, policy, memory, and review flow.
---

# Core Concepts

Murph is a local-first handoff agent. Its core job is to watch selected async channels while you are offline, understand whether an incoming message needs you, gather relevant context, draft a bounded response, and apply policy before anything is sent.

It is not an always-on chatbot. The product is built around explicit sessions, local configuration, source-grounded answers, and reviewable audit trails.

## Local-first model

Murph runs on your machine and keeps operational state in your Murph home.

- SQLite stores sessions, runs, events, tool calls, policy decisions, action results, and indexing state.
- `~/.murph/config.yaml` stores non-secret setup and runtime configuration.
- `~/.murph/.credentials` stores local secrets with owner-only permissions.
- `~/.murph/memory` stores generated markdown recall pages when configured through `app.memoryPath`.
- The browser UI, CLI, and Murph Agent all control the same local runtime.

Credentials are not uploaded to Murph servers. They only leave your machine when Murph uses them to call the providers, channels, or integrations you connected.

## Agent runtime

The agent runtime is the center of Murph. It turns channel activity into a policy-gated action.

At a high level, the runtime loop is:

1. A channel adapter receives a Slack, Discord, or plugin channel event.
2. The adapter normalizes the event into a task with workspace, thread, actor, target user, and trigger message details.
3. The gateway checks for an active session that matches the workspace, owner, channel scope, and handoff window.
4. The runtime assembles context from the current thread, session memory, workspace settings, selected skills, generated memory index, and enabled integrations.
5. The tool planner decides which read-only retrieval tools are available and whether grounding is required before drafting.
6. The model drafts a proposed action such as reply, ask, redirect, defer, remind, or abstain.
7. Policy classification and deterministic policy gates decide whether the action may send, must queue for review, or should abstain.
8. Murph executes the allowed action or creates a review item.
9. Run events, tool results, policy decisions, and final outcomes are stored for triage, audit, and future memory indexing.

This is why source access, policy, and session scope matter. Murph is useful when it can answer from the current thread or connected sources and conservative when it cannot.

## Sessions

A session is a bounded offline handoff window. You start a session before going offline, choose which channels Murph may watch, and set the policy posture for that handoff.

Sessions carry:

- the owner identity Murph is covering for
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

Context helps the agent understand the request. It can include the current thread, session metadata, user/workspace memory, selected skills, linked artifacts, and generated memory index entries.

Evidence supports factual answers. It should come from current thread content, connected integration reads, read-only tool results, or a loaded memory page with provenance for stable follow-up questions.

For latest, current, today, now, status, changed, or source-of-truth requests, Murph should use live retrieval from connected sources. Generated memory alone is not enough for fresh state.

## Channels, integrations, tools, and skills

Murph uses a few capability types consistently.

| Term | Meaning |
| --- | --- |
| Channels | Messaging places Murph watches and replies in, such as Slack and Discord. |
| Integrations | Connected work sources Murph can read for context, such as Notion, GitHub, Gmail, Calendar, Granola, and Obsidian. |
| Tools | Callable runtime actions, usually read-only retrieval or source access. |
| Skills | Instructions that teach Murph when and how to use a source, workflow, or evidence type. |
| Plugins | Local extension packages that add channels, integrations, tools, or skills. |

Skills are not a separate agent. They shape the runtime's behavior once relevant capabilities are available.

## Memory

Murph has two memory surfaces.

SQLite is the source of truth for what happened. It preserves the transactional history of sessions, runs, events, tools, policy, and actions.

Generated markdown memory is a recall layer. It builds compact thread and session pages under the configured memory path so the agent can answer stable follow-up questions without scanning raw run history every time.

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

Murph has three operator surfaces:

- [Browser UI](/docs/usage/browser-ui) for setup, sessions, status, triage, and review.
- [CLI](/docs/usage/cli) for setup, process control, health checks, credentials, and policy.
- [Murph Agent](/docs/usage/murph-agent) for guided local help with setup, debugging, policy, and scoped extension work.

All three surfaces operate on the same local configuration and runtime state.

## Extensibility

Murph ships defaults for channels, integrations, tools, skills, policy profiles, providers, and storage, but those defaults are not a closed set.

New channels, integrations, skills, policies, model providers, search providers, and fetch backends should plug into existing extension points instead of changing the handoff workflow. For most local needs, start with scoped plugins under `~/.murph/plugins`.
