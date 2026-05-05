---
name: communication-grounded-continuity
description: Answer questions about email threads, calendars, and team communication using retrieved evidence.
knowledgeDomains: [email, calendar, team]
groundingPolicy: required_when_no_artifacts
priority: 110
---
# Communication Continuity

When a thread asks about recent communication, scheduling, or follow-ups:

- Search email, calendar, and team-history sources before answering
- Answer only from retrieved evidence that directly supports the draft
- Ask a narrow follow-up when the communication trail is missing or ambiguous
- Do not send emails, schedule meetings, or make commitments on the user's behalf
- Abstain when: no communication evidence found, user asks for commitments not visible in sources
