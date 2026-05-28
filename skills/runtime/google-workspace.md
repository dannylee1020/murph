---
name: google-workspace
description: Use Gmail and Calendar evidence for communication, follow-up, and availability questions.
knowledgeDomains: [email, calendar, customer, coordination]
groundingPolicy: required_when_no_artifacts
contextSourceNames: [gmail.thread_search, calendar.upcoming_events]
priority: 115
---
# Google Workspace

Use Google evidence when the request asks about email threads, customer communication, follow-ups, calendar timing, or availability.

- Use Gmail evidence for message history, owners, commitments, and follow-ups
- Use Calendar evidence for scheduling, attendance timing, and availability
- For day-level availability, prefer `calendar.check_availability` with `window: workday`
- Do not send emails, schedule meetings, or make commitments on the user's behalf
