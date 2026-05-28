---
name: github-code
description: Use GitHub evidence for code, issue, pull request, and repository status questions.
knowledgeDomains: [code, documentation]
groundingPolicy: required_when_no_artifacts
contextSourceNames: [github.thread_search]
priority: 105
---
# GitHub Code

Use GitHub evidence when the request asks about code state, issues, pull requests, reviews, or repository decisions.

- Use `github.search` for discovery, then read the relevant issue or pull request when more detail is needed
- Keep repository, issue, and pull request names explicit in the answer
- Do not treat an old issue or pull request as current state without retrieved evidence
- Defer when the source does not directly support the requested status
