# Policy Profiles

Policy profiles in this directory define the reusable rules Nightclaw applies before it sends, queues, or abstains on a continuity action.

These files are profile inputs, not a separate policy engine. The runtime loads `policies/*.md`, parses the metadata header plus the body, and compiles the result into the same `CompiledPolicy` shape used everywhere else.

## File Shape

Each profile is a Markdown file with:

1. A metadata header at the top
2. A separator line containing `---`
3. Freeform body text used as additional agent notes

Example:

```md
name: founder-coverage
description: Conservative profile for founders, executives, and externally sensitive threads.
blockedTopics: payroll, legal, performance reviews
alwaysQueueTopics: launch decisions, customer escalations, pricing
blockedActions:
allowAutoSend: no
requireGroundingForFacts: yes
preferAskWhenUncertain: yes
notes: keep replies short, avoid commitments without proof
---
Use a cautious tone. Answer only from thread context or grounded sources.
Queue anything that could commit the owner or the company.
```

## Supported Metadata

- `name`: Profile name shown in the UI and stored on the user/session.
- `description`: Short UI description.
- `blockedTopics`: Comma-separated topics that force abstain when they appear in the latest thread message.
- `alwaysQueueTopics`: Comma-separated topics that force operator review instead of direct send.
- `blockedActions`: Comma-separated action verbs from `reply, ask, redirect, defer, remind, abstain`.
- `allowAutoSend`: `yes/no` or `true/false`. Only matters when the session mode would otherwise allow direct send.
- `requireGroundingForFacts`: `yes/no` or `true/false`.
- `preferAskWhenUncertain`: `yes/no` or `true/false`.
- `notes`: Comma-separated short instructions appended to agent notes.

The body below `---` is also appended to `notesForAgent`, one non-empty line at a time.

## How Profiles Are Chosen

Effective policy precedence is:

1. Session-selected profile, if provided when starting the session
2. User-assigned profile
3. Workspace default profile
4. Built-in fallback for the session mode

Any optional override text entered in the UI is merged on top of the selected base profile.

## What Overrides Can Change

Overrides only support the same compiled fields the parser recognizes:

- blocked topics
- always queue topics
- blocked actions
- require grounding for facts
- prefer ask when uncertain
- allow auto-send
- notes

Overrides are additive for list fields and replace booleans when explicitly set.

## Important Limits

- Matching is intentionally simple. Topic checks use lowercase substring matching against the latest message text.
- Profiles do not assign themselves automatically. Assignment happens through workspace defaults, per-user settings, or session setup.
- `allowAutoSend: yes` does not bypass session mode. `manual_review` still queues by default, and `dry_run` still records without side effects.
- High-risk skill contexts can still force review even when a profile allows low-risk auto-send.

## Authoring Guidance

- Keep topic names short and explicit.
- Prefer queueing ambiguous business decisions over broad blocked lists.
- Put durable rules in metadata and tone/behavior instructions in the body.
- If a rule needs code-level behavior beyond the compiled fields above, add runtime support first instead of encoding wishful text here.
