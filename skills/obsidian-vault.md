---
name: obsidian-vault
description: Use Obsidian vault notes as local knowledge-base and decision evidence.
knowledgeDomains: [documentation, meeting]
groundingPolicy: required_when_no_artifacts
contextSourceNames: [obsidian.thread_search]
priority: 108
---
# Obsidian Vault

Use Obsidian evidence when the request asks about local notes, knowledge-base entries, meeting notes, decisions, plans, or personal docs.

- Use `obsidian.search` for discovery, then `obsidian.read_note` when a specific note is needed
- Treat vault-relative note content as evidence, not just the note title or path
- Preserve note titles or relative paths when citing what informed the answer
- Say what is missing when the vault search returns weak or unrelated notes
