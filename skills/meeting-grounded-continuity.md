---
name: meeting-grounded-continuity
description: Answer recap and decision questions using meeting notes, transcripts, and related documentation.
knowledgeDomains: [meeting, documentation]
groundingPolicy: required_when_no_artifacts
priority: 115
---
# Meeting Continuity

When a thread asks what was said or decided in a meeting:

- Search relevant meeting sources first — transcripts, notes, and supporting documentation or communication — for evidence before answering
- Do not call calendar unless the user asks about scheduling, attendance timing, or availability
- Ask a narrow follow-up when the meeting record is missing or incomplete
- Do not overstate decisions that are not explicitly present in retrieved meeting evidence
- Abstain when: transcript missing, question better answered by code/docs sources, requires quoting an unretrieved meeting
