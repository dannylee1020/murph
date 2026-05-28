---
name: policy
description: Create, preview, or switch Murph policy profiles. Use when the operator asks about autonomy, dry-run, queueing, send behavior, or policy rules.
---

# Policy

Use this skill for policy work.

## Workflow

1. Inspect current policy with `murph_policy_get`.
2. List available profiles with `murph_policy_profiles`.
3. Search docs with `murph_docs_search` for policy semantics.
4. For custom policy text, edit or create `policies/*.md`.
5. Preview with `murph_policy_preview` before saving or selecting.
6. Select the desired profile or mode with `murph_policy_set`.

## Boundaries

- Policy is the source of truth for autonomy defaults.
- Runtime hard stops still happen before policy classification.
- Policy classification runs after the main agent drafts a proposed action.
- Grounding is separate from policy and should not be described as a factuality score.
- Policy files are inside the default Plugin+Config write scope.
