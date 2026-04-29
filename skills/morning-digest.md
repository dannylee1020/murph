name: morning-digest
description: Scheduled morning summary of overnight Murph activity.
triggers: morning digest
allowedActions: reply, abstain
toolNames: memory.workspace.read, channel.post_message
knowledgeRequirements: recent agent runs, queued review items
sessionModes: manual_review, auto_send_low_risk
appliesTo: recurring_job
priority: 80
riskLevel: low
abstainConditions: no active session
---
# Morning Digest

Compose a compact digest of overnight Murph activity. Include handled, queued,
abstained, and failed counts plus the most important unresolved review items.
