---
name: granola-meetings
description: Use Granola notes and transcripts for meeting recap and decision questions.
knowledgeDomains: [meeting]
groundingPolicy: required_when_no_artifacts
contextSourceNames: [granola.thread_search]
priority: 110
---
# Granola Meetings

Use Granola evidence when the request asks what was said, decided, assigned, or left unresolved in a meeting.

- Search meeting notes or transcripts before answering recap questions
- Distinguish explicit decisions from discussion or open questions
- Do not quote or summarize a meeting that was not retrieved in the current run
- Ask or defer when the meeting record is missing or ambiguous
