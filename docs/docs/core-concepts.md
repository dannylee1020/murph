---
title: Core Concepts
description: Understand sessions, context, skills, policy, and triage.
---

# Core Concepts

Murph is built around bounded offline coverage, not an always-on chatbot.

## Sessions

A session is a period of coverage. You start a session before going offline, choose the channels to watch, and let Murph handle matching incoming work.

## Session context

At session start, Murph builds a context snapshot from handoff notes and connected sources. That snapshot gives later decisions a shared baseline without re-fetching broad context on every message.

## Skills

Skills describe how Murph should handle different kinds of requests. They help Murph choose the right behavior and the right context sources.

Examples include:

- channel continuity
- communication
- meeting questions
- documentation lookup
- morning digest

## Grounded responses

Murph retrieves relevant context before drafting. The runtime prefers evidence from connected sources over unsupported guesses.

## Policy

Policy decides whether a draft can be sent, queued, or skipped. Built-in policy profiles are conservative; they are designed to keep risky actions in review.

## Triage and audit

After a session, triage shows what Murph handled, queued, or skipped. Run events preserve context, tool calls, policy decisions, and final action results.
