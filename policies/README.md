# Policy Profiles

Policy profiles in this directory define the reusable rules Murph applies before it sends, queues, or abstains on a continuity action.

These files are profile inputs, not a separate policy engine. The runtime loads `policies/*.md`, parses the metadata header plus the body, and compiles the result into the same `CompiledPolicy` shape used everywhere else.

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
- `allowAutoSend`: `yes/no` or `true/false`. Only matters when the session mode would otherwise allow direct send.
- `requireGroundingForFacts`: `yes/no` or `true/false`.
- `preferAskWhenUncertain`: `yes/no` or `true/false`.
- `notes`: Comma-separated short instructions appended to agent notes.
- `scopedRules`: Optional JSON array of channel/intent/action scoped rules.

The body below `---` is also appended to `notesForAgent`, one non-empty line at a time.

## How Profiles Are Chosen

Effective policy precedence is:

1. The compiled policy snapshot already attached to an active session
2. The local policy profile selected in Admin or `murph policy set`
3. Built-in fallback for the session mode

Admin only selects an existing local profile. More advanced editing belongs in profile files, CLI flows, or future agent-managed configuration.

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

## Important Limits

- Matching is intentionally simple. Topic checks use lowercase substring matching against the latest message text.
- Profiles do not assign themselves automatically. Select the local policy profile in Admin or with `murph policy set --profile NAME`.
- Shipped profiles keep `allowAutoSend: no` by default. Opt into auto-send only from an explicitly custom profile.
- `allowAutoSend: yes` does not bypass session mode. `manual_review` still queues by default, and `dry_run` still records without side effects.
- High-risk skill contexts can still force review even when a profile allows low-risk auto-send.
- Active sessions keep the compiled policy snapshot they started with. Policy edits apply to new sessions unless the session is restarted.

## Authoring Guidance

- Keep topic names short and explicit.
- Prefer queueing ambiguous business decisions over broad blocked lists.
- Put durable rules in metadata and tone/behavior instructions in the body.
- If a rule needs code-level behavior beyond the compiled fields above, add runtime support first instead of encoding wishful text here.
