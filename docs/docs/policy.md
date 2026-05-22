---
title: Policy
description: Customize Murph policy profiles with Murph Agent or local profile files.
---

# Policy

Policy controls what Murph does with a drafted response when a session is running.

Murph Agent is the preferred way to create or adjust a custom profile:

```bash
murph agent
```

Ask it to inspect your current policy, create a new profile, preview the result, and select it.

## Shipped profiles

Murph ships role-oriented profiles:

- `default`
- `engineering`
- `product`
- `sales`
- `marketing`
- `leadership`
- `yolo`

The role profiles are conservative and keep auto-send off. `yolo` is the maximum-autonomy preset for trusted local runs after you have verified setup and behavior. Runtime grounding still checks that required read/context work happens before answering.

## Custom profile files

Profiles live in `policies/*.md` and use a metadata header plus body notes:

```md
name: custom
description: My custom policy.
blockedTopics: payroll details, legal advice
alwaysQueueTopics: pricing, customer commitments
blockedActions:
mode: manual_review
allowAutoSend: no
requireGroundingForFacts: yes
preferAskWhenUncertain: yes
notes: keep replies concise, avoid promises
---
Extra instructions for Murph when this profile is active.
```

Use the CLI to inspect, preview, and select profiles:

```bash
murph policy profiles
murph policy preview --profile custom --mode auto_send_low_risk
murph policy set --profile custom --mode manual_review
```

## How policy runs

Murph keeps operational hard stops before the agent: no matching session, unknown target user, owner-authored events, expired sessions, and similar runtime conditions stop without drafting.

When those hard stops pass, the main agent drafts first. Then a policy execution classifier reviews the request, policy, grounding status, and proposed action.

The deterministic final gate remains authoritative. `dry_run`, temporary manual review, policy `mode: manual_review`, blocked topics, blocked actions, high-risk skill context, unsupported action types, and low-confidence classifier sends can still force `queue` or `abstain`. Grounding is separate runtime behavior: it checks whether required read/context tools were attempted, but it does not prove factual correctness.

## Policy mode is the default

Policy mode is the default autonomy posture for new sessions:

- `manual_review` queues drafted actions for review.
- `auto_send_low_risk` can send low-risk actions automatically and queue the rest.

Save the durable default in `~/.murph/config.yaml` from Admin or the CLI:

```bash
murph policy set --mode manual_review
murph policy set --mode auto_send_low_risk
```

Session mode is now a temporary override. Starting a session without a mode inherits policy mode. A dry run records decisions without side effects, and a manual-review session queues everything for that run. Session overrides cannot increase autonomy beyond policy mode; a manual-review policy still queues even if a caller asks for `auto_send_low_risk`.

Runtime hard stops still apply for empty context, out-of-scope threads, high-risk skill context, unsupported action types, and messages Murph cannot safely send.

## YOLO profile

Use `yolo` when you intentionally want the least restrictive action profile:

```bash
murph policy set --profile yolo
```

`yolo` defaults policy mode to low-risk auto-send and disables the uncertainty preference, but it does not disable runtime grounding. Murph should use materially relevant read-only retrieval or context tools before answering factual questions. It is explicit by design; fresh installs do not select it automatically.
