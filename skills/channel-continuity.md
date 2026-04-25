name: channel-continuity
description: Default skill for channel thread continuity when the target user is offline.
triggers: status request, blocker, clarification, handoff
allowedActions: reply, ask, redirect, defer, remind, abstain
toolNames: channel.fetch_thread, user.get_preferences, memory.workspace.read, memory.thread.read, memory.thread.write, channel.post_reply, reminder.schedule, queue.enqueue
channelNames: slack
contextSourceNames: memory.linked_artifacts
knowledgeRequirements: channel thread history, user preferences, workspace routing hints, thread memory
sessionModes: dry_run, manual_review, auto_send_low_risk
appliesTo: channel_thread, overnight_autopilot
priority: 100
riskLevel: low
abstainConditions: requires policy exception, missing factual grounding, asks for irreversible decision
---
# Channel Continuity

When a thread depends on an offline user:

- prefer a bounded status-preserving response over speculation
- ask for missing information if the request is ambiguous
- redirect only when a likely fallback owner is already visible in context
- abstain if the thread requires domain certainty that is not in channel history
