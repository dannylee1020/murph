# Policy Profiles

Policy profiles in this directory are the shipped defaults Murph uses to decide whether it may send, queue, or abstain from a drafted continuity action.

These files are profile inputs, not a separate policy engine. The runtime loads shipped `policies/*.md` first, then user profiles from `~/.murph/policies/*.md`. A user profile with the same normalized name overrides the shipped profile. Murph parses the metadata header plus the body and compiles the result into the same `CompiledPolicy` shape used everywhere else.

## File Shape

Each profile is a Markdown file with:

1. A metadata header at the top
2. A separator line containing `---`
3. Freeform body text used as additional agent notes

Example:

```md
name: default
description: Generic safe profile for local-first Murph coverage.
blockedTopics: payroll details, compensation, performance reviews, legal advice
alwaysQueueTopics: customer escalations, company commitments, deadlines, pricing
blockedActions:
mode: manual_review
allowAutoSend: no
requireGroundingForFacts: yes
preferAskWhenUncertain: yes
notes: keep replies short, avoid commitments, queue ambiguous decisions
---
Answer only from grounded thread or connected-source context.
Queue anything that commits the operator or changes priorities.
```

## Supported Metadata

- `name`: Profile name shown in the UI and stored on new sessions.
- `description`: Short UI description.
- `blockedTopics`: Comma-separated topics that force abstain when they appear in the latest thread message.
- `alwaysQueueTopics`: Comma-separated topics that force operator review instead of direct send.
- `blockedActions`: Comma-separated action verbs from `reply, ask, redirect, defer, remind, abstain`.
- `mode`: `manual_review` or `auto_send_low_risk`. This is the policy's default autonomy posture.
- `allowAutoSend`: Legacy `yes/no` or `true/false` metadata. It is still read for compatibility when `mode` is missing, but `mode` is the source of truth when both are present.
- `requireGroundingForFacts`: `yes/no` or `true/false`. This is consumed by runtime grounding, not by the policy authorization gate.
- `preferAskWhenUncertain`: `yes/no` or `true/false`.
- `notes`: Comma-separated short instructions appended to agent notes.
- `scopedRules`: Optional JSON array of channel/intent/action scoped rules.

The body below `---` is also appended to `notesForAgent`, one non-empty line at a time.

## How Profiles Are Chosen

Effective policy precedence is:

1. The compiled policy snapshot already attached to an active session
2. The local policy mode and profile selected in Admin or `murph policy set`
3. Built-in manual-review fallback

Admin selects an existing local profile and the default execution mode. For custom policy, use `murph agent` first; direct profile-file editing is the fallback when you want to manage `~/.murph/policies/*.md` yourself.

## Scoped Rules

The compiled policy can include scoped rules that apply only when the runtime task matches a channel, intent, or proposed action type. Scoped rules are configured through YAML, CLI, or agent-managed updates; profile files may also include a `scopedRules` metadata value as JSON.

Example rules file:

```json
[
  {
    "id": "launch-review",
    "name": "Launch review",
    "match": {
      "channelIds": ["C123"],
      "intents": ["status_request"],
      "actionTypes": ["reply"]
    },
    "controls": {
      "allowAutoSend": false
    }
  }
]
```

Rule matching is deterministic: global policy is applied first, then every matching scoped rule from less specific to more specific. List fields are additive, boolean fields use the most specific matching value, and hard blocks remain conservative.

## Runtime Flow

Murph keeps operational hard stops before the main agent: no active matching session, unknown target user, owner-authored events, expired sessions, and similar runtime conditions stop immediately.

If those checks pass, the main agent drafts first. A small no-tool policy execution classifier then reviews the request, selected policy, grounding status, and proposed action and returns `send`, `queue`, or `abstain`. This keeps queued work useful because the queue can include the agent's proposed message.

After classification, Murph applies deterministic blocked-action/topic/rule checks before execution. Those deterministic checks are authoritative over the classifier.

Grounding is a separate runtime obligation. It checks whether required read/context tools were attempted; it does not verify factual correctness claim by claim.

## Important Limits

- Deterministic topic matching is intentionally simple. Nuanced execution routing is handled by the no-tool policy execution classifier after the main agent drafts.
- Profiles do not assign themselves automatically. Select the local policy profile in Admin or with `murph policy set --profile NAME`.
- Shipped role profiles keep `mode: manual_review` by default. `yolo` is the explicit maximum-autonomy shipped profile for trusted local runs, but runtime grounding still expects materially relevant read-only tools before factual answers.
- New sessions inherit policy mode by default. Session mode is only a temporary override: `dry_run` records without side effects, and manual review queues everything for that run.
- Session overrides cannot increase autonomy beyond policy mode. A manual-review policy still queues even if a caller asks for low-risk auto-send.
- High-risk skill contexts can still force review even when a profile allows low-risk auto-send.
- Active sessions keep the compiled policy snapshot they started with. Policy edits apply to new sessions unless the session is restarted.

## Authoring Guidance

- Keep topic names short and explicit.
- Prefer queueing ambiguous business decisions over broad blocked lists.
- Put durable rules in metadata and tone/behavior instructions in the body.
- If a rule needs code-level behavior beyond the compiled fields above, add runtime support first instead of encoding wishful text here.
