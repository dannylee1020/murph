name: communication-grounded-continuity
description: Continuity skill for questions grounded in email threads, calendars, and team communication history.
triggers: customer, email, thread, follow up, follow-up, calendar, meeting time, availability, schedule, reschedule, when is, did we reply, did I send, latest email
allowedActions: reply, ask, redirect, defer, remind, abstain
toolNames: channel.fetch_thread, user.get_preferences, memory.workspace.read, memory.thread.read, memory.thread.write, memory.thread.link_artifact, channel.post_reply, reminder.schedule, queue.enqueue
knowledgeDomains: email, calendar, team
groundingPolicy: required_when_no_artifacts
channelNames: slack
contextSourceNames: memory.linked_artifacts
knowledgeRequirements: channel thread history, user preferences, workspace routing hints, thread memory, shared communication sources
sessionModes: dry_run, manual_review, auto_send_low_risk
appliesTo: channel_thread, overnight_autopilot
priority: 110
riskLevel: low
abstainConditions: missing communication evidence, asks for commitments not visible in retrieved sources, requires sending email or making calendar changes
---
# Communication Grounded Continuity

When a thread asks about recent communication, scheduling, or whether someone replied:

- prefer email, calendar, and team-history sources over inference from channel chatter
- answer only from retrieved evidence that directly supports the draft
- ask a narrow follow-up or abstain when the communication trail is missing or ambiguous
- keep the reply bounded to continuity work and avoid sending, scheduling, or committing on the user’s behalf
