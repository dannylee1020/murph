---
title: Policy
description: Customize Murph policy profiles with Murph Agent or local profile files.
---

# Policy

Policy controls what Murph does with a drafted response when a session is running. The selected policy profile is the source of truth for Murph's default autonomy.

For the full policy profile format, runtime order, and metadata reference, use [Extending Policy](/docs/developing/extending/policy).

Murph Agent is the preferred way to create, preview, and select a custom profile:

```bash
murph agent
```

Ask it to inspect your current policy, create a new profile, preview the result, and select it. The selected profile name is stored in `~/.murph/config.yaml`; the profile file itself owns `mode`.

## Shipped profiles

Murph ships role-oriented profiles:

- `default`
- `engineering`
- `product`
- `investor`
- `yolo`

The role profiles are conservative and keep auto-send off with `mode: manual_review`. `yolo` is the maximum-autonomy preset for trusted local runs after you have verified setup and behavior. Runtime grounding still checks that required read/context work happens before answering.

## Custom profile files

Shipped profiles live in the app's `policies/` directory. Custom profiles live in `~/.murph/policies/*.md` and use a metadata header plus body notes. Set `mode` in the profile; do not add a separate `policy.mode` config value.

```md
name: custom
description: My custom policy.
blockedTopics: payroll details, legal advice
alwaysQueueTopics: pricing, customer commitments
blockedActions:
mode: manual_review
requireGroundingForFacts: yes
preferAskWhenUncertain: yes
notes: keep replies concise, avoid promises
---
Extra instructions for Murph when this profile is active.
```

Use the CLI to inspect, preview, and select profiles:

```bash
murph policy profiles
murph policy preview --profile custom
murph policy preview --profile custom --session-mode dry_run
murph policy set --profile custom
```

## How policy runs

```text
Message arrives
  |
  v
Runtime hard stops
(no session, out of scope, expired, missing Personal owner)
  |
  v
Agent drafts action
(reply, ask, redirect, defer, remind, abstain)
  |
  v
Grounding check
(required read/context tools attempted)
  |
  v
Policy classifier
(request + policy + grounding + draft)
  |
  v
Deterministic final gate
(profile mode, blocked topics/actions, risk, confidence)
  |
  v
Send | Queue | Abstain
```

Hard stops happen before Murph drafts.

The deterministic final gate is authoritative. Grounding checks whether required retrieval was attempted, but it does not prove factual correctness.

## Profile mode is the default

Each policy profile declares its own execution mode. That profile mode is the default autonomy posture for new sessions:

- `manual_review` queues drafted actions for review.
- `auto_send_low_risk` can send low-risk actions automatically and queue the rest.

Select the durable default profile from Admin or the CLI:

```bash
murph policy set --profile engineering
murph policy set --profile yolo
```

Session mode is a temporary override. Starting a session without a mode inherits the selected profile mode. A dry run records decisions without side effects, and a manual-review session queues everything for that run. Session overrides cannot increase autonomy beyond the profile mode; a manual-review profile still queues even if a caller asks for `auto_send_low_risk`.

Runtime hard stops still apply for empty context, out-of-scope threads, high-risk skill context, unsupported action types, and messages Murph cannot safely send.

## Team hosts

In a shared messenger channel Team host, policy resolves at the team runtime level. New config-bound Team sessions snapshot the selected Team policy profile.

Session overrides cannot raise autonomy beyond the selected profile mode. A `manual_review` profile still prevents a session request from raising execution to `auto_send_low_risk`.

## YOLO profile

Use `yolo` when you intentionally want the least restrictive action profile:

```bash
murph policy set --profile yolo
```

`yolo` sets profile mode to low-risk auto-send and disables the uncertainty preference, but it does not disable runtime grounding. Murph should use materially relevant read-only retrieval or context tools before answering factual questions. It is explicit by design; fresh installs do not select it automatically.
