---
name: communication-grounded-continuity
description: Answer questions about email threads, calendars, and team communication using retrieved evidence.
knowledgeDomains: [email, calendar, team]
groundingPolicy: required_when_no_artifacts
priority: 110
---
# Communication Continuity

When a thread asks about recent communication, scheduling, or follow-ups:

- Search the sources relevant to the request before answering; do not call unrelated tools just because they are available
- Use email/team history for communication questions, calendar for scheduling/availability, and documentation/notes only when the thread asks for those facts
- For availability or scheduling questions, call `calendar.search_events` with explicit `timeMin` and `timeMax` for the requested window and a limit large enough to cover that window
- For “is <day> good for a sync?” without a specific time, call `calendar.check_availability` with `window: workday` for that date and answer directly from the conflict result
- Answer only from retrieved evidence that directly supports the draft
- Ask a narrow follow-up when the communication trail is missing or ambiguous
- Do not send emails, schedule meetings, or make commitments on the user's behalf
- Abstain when: no communication evidence found, user asks for commitments not visible in sources
