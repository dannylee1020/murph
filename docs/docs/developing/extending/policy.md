---
title: Extending Policy
description: Create policy profiles that control send, queue, and abstain behavior.
---

# Extending Policy

Policy profiles control Murph's autonomy after a draft exists.

Use policy when the question is "may Murph send this?" Use skills when the question is "how should Murph interpret or answer this?"

## File location

Policy profiles live in:

```text
~/.murph/policies/*.md
```

Murph loads the shipped app profiles first, then Markdown files in `~/.murph/policies`. A user profile with the same normalized name overrides the shipped profile. `README.md` is ignored.

## File shape

```md
name: engineering
description: Engineering coverage for technical status, incidents, releases, and implementation threads.
blockedTopics: compensation, performance reviews, legal advice
alwaysQueueTopics: production incidents, security vulnerabilities, data loss
blockedActions:
mode: manual_review
allowAutoSend: no
requireGroundingForFacts: yes
preferAskWhenUncertain: yes
notes: cite technical evidence, avoid changing commitments
---
Reply with bounded engineering continuity from thread context, tickets, docs, or code references.
Queue incident ownership, security impact, data changes, release decisions, and access or secrets requests.
```

The header is simple `key: value` metadata. The body becomes additional notes for the agent and policy classifier.

## Metadata

| Field | Purpose |
| --- | --- |
| `name` | Stable profile name. Defaults to filename. |
| `description` | Profile summary shown in setup surfaces. |
| `blockedTopics` | Comma-separated topics that force abstain. |
| `alwaysQueueTopics` | Comma-separated topics that force review. |
| `blockedActions` | Comma-separated action types to block. |
| `mode` or `executionMode` | `manual_review` or `auto_send_low_risk`. |
| `allowAutoSend` | Legacy boolean fallback for mode. |
| `requireGroundingForFacts` | Whether factual replies should require grounding attempts. |
| `preferAskWhenUncertain` | Whether uncertainty should bias toward asking or queueing. |
| `notes` | Comma-separated classifier and agent notes. |
| `scopedRules` | Optional JSON for narrower rule overrides. |

## Runtime order

Murph applies policy after the main agent drafts.

The runtime still has hard stops before drafting, such as no matching session, owner-authored events, expired sessions, unsupported action types, or missing context.

After drafting, policy classification and the deterministic final gate decide whether the action sends, queues, or abstains.

## Policy mode

`manual_review` queues drafted actions for review.

`auto_send_low_risk` can send low-risk actions automatically and queue the rest.

Session mode can temporarily reduce autonomy, but it cannot increase autonomy beyond the durable policy mode.

## Commands

List profiles:

```bash
murph policy profiles
```

Preview a profile:

```bash
murph policy preview --profile engineering --mode manual_review
```

Select a profile:

```bash
murph policy set --profile engineering
```

Set durable policy mode:

```bash
murph policy set --mode manual_review
murph policy set --mode auto_send_low_risk
```

Use `yolo` only when you intentionally want maximum local autonomy. It does not disable runtime grounding.
