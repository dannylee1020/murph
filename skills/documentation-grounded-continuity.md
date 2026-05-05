---
name: documentation-grounded-continuity
description: Ground replies in shared documentation, notes, and decision logs.
knowledgeDomains: [documentation, code]
groundingPolicy: required_when_no_artifacts
priority: 120
---
# Documentation Continuity

When a thread asks for facts that may live in shared documentation:

- Use the best available retrieval tool to find the relevant document before answering
- Read the most relevant page before relying on it
- Use document content only when it directly supports the draft
- Ask a narrow follow-up when no documentation source contains the needed fact
- Abstain when: no documentation grounding available, requires private or unshared documents, asks for irreversible decisions
