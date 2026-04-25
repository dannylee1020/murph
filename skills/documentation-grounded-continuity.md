name: documentation-grounded-continuity
description: Continuity skill that grounds replies in shared documentation, notes, and decision logs.
triggers: doc, docs, documentation, readiness, launch plan, go live, go-live, clear to go live, clear to launch, go/no-go, decision, signoff, approval, hold, ship, release, ready tomorrow, decision log, meeting notes, spec, PRD, RFC, wiki, regex:\b(runbook|playbook|handbook|guide|policy|notes)\b, regex:\bsource of truth\b
allowedActions: reply, ask, redirect, defer, remind, abstain
toolNames: channel.fetch_thread, user.get_preferences, memory.workspace.read, memory.thread.read, memory.thread.write, memory.thread.link_artifact, channel.post_reply, reminder.schedule, queue.enqueue
knowledgeDomains: documentation
groundingPolicy: required_when_no_artifacts
channelNames: slack
contextSourceNames: memory.linked_artifacts
knowledgeRequirements: channel thread history, user preferences, workspace routing hints, thread memory, shared documentation content
sessionModes: dry_run, manual_review, auto_send_low_risk
appliesTo: channel_thread, overnight_autopilot
priority: 120
riskLevel: low
abstainConditions: missing documentation grounding, requires private or unshared document, asks for irreversible decision
---
# Documentation Grounded Continuity

When a thread asks for facts that may live in shared documentation:

- choose the best available documentation/source-of-truth retrieval tool to find the document before answering
- read the most relevant page before relying on it
- use document content only when it directly supports the draft
- ask a narrow follow-up or abstain when no documentation source contains the needed fact
- keep the reply bounded to continuity work and avoid making commitments for the offline user
