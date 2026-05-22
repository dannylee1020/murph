---
title: Core Concepts
description: Understand sessions, context, skills, policy, and triage.
---

# Core Concepts

Murph is built around bounded offline handoffs, not an always-on chatbot.

## Sessions

A session is a bounded handoff window. You start a session before going offline, choose the channels to watch, and let Murph handle matching incoming work.

## Capability taxonomy

Murph uses a few public terms consistently:

| Term | Meaning |
| --- | --- |
| Channels | Messaging places Murph watches and replies in, such as Slack and Discord. |
| Integrations | Connected work sources Murph can use for context, such as Notion, GitHub, Gmail, Calendar, Granola, and Obsidian. |
| Tools | Callable actions Murph can run, such as web search, web fetch, source search, file read, or shell. |
| Plugins | Local extension packages that add channels, integrations, tools, or skills. |
| Skills | Instructions that teach Murph how to use a specific source or tool well. |
| Connectors | Plugin modules that connect one external source to Murph. |

## Skills

Skills describe how Murph should use specific integrations and evidence sources. Skills add source-specific guidance once the matching integration is available.

Examples include:

- Notion documentation
- Google Gmail and Calendar
- Granola meeting notes
- GitHub issues and pull requests

## Grounded responses

Murph retrieves relevant context before drafting. The runtime prefers evidence from connected sources over unsupported guesses.

## Policy

Policy decides whether Murph may send, queue, or abstain from a drafted action. Operational hard stops still happen before the agent, but policy classification runs after the main agent drafts so queued items can include useful work. Grounding is separate runtime behavior, not a factuality score. Built-in role profiles are conservative; `yolo` is available as an explicit maximum-autonomy preset. Custom profiles are best created with Murph Agent or by editing `policies/*.md`.

## Triage and audit

After a session, triage shows what Murph handled, queued, or skipped. Run events preserve context, tool calls, policy decisions, and final action results.
