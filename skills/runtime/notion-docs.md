---
name: notion-docs
description: Use Notion as shared documentation and decision-log evidence.
knowledgeDomains: [documentation]
groundingPolicy: required_when_no_artifacts
contextSourceNames: [notion.thread_search]
priority: 120
---
# Notion Docs

Use Notion evidence when the request asks about shared docs, plans, decisions, specs, or handoffs.

- Treat `notion.search` as discovery and `notion.read_page` as the source-of-truth read path
- Answer only from retrieved page content that directly supports the draft
- Say what is missing when search results are weak or unrelated
- Do not infer a decision from a page title alone
