name: meeting-grounded-continuity
description: Continuity skill for recap and decision questions grounded in meeting notes, transcripts, and nearby documentation.
triggers: meeting, notes, transcript, what did, what was decided, what did they say, call notes, customer call, pilot call, recap
allowedActions: reply, ask, redirect, defer, remind, abstain
toolNames: channel.fetch_thread, user.get_preferences, memory.workspace.read, memory.thread.read, memory.thread.write, memory.thread.link_artifact, channel.post_reply, reminder.schedule, queue.enqueue
knowledgeDomains: meeting, documentation
groundingPolicy: required_when_no_artifacts
channelNames: slack
contextSourceNames: memory.linked_artifacts
knowledgeRequirements: channel thread history, user preferences, workspace routing hints, thread memory, meeting notes or transcript evidence
sessionModes: dry_run, manual_review, auto_send_low_risk
appliesTo: channel_thread, overnight_autopilot
priority: 115
riskLevel: low
abstainConditions: transcript missing, asks for authoritative implementation status better answered by code or docs sources, requires quoting a meeting that is not retrieved
---
# Meeting Grounded Continuity

When a thread asks what was said or decided in a meeting:

- prefer transcript or note evidence before answering from memory or channel recap
- use documentation only as supporting context when it clarifies the meeting outcome
- ask a narrow follow-up or abstain when the meeting record is missing or incomplete
- avoid overstating decisions that are not explicitly present in retrieved meeting evidence
