---
title: Extending Skills
description: Add source-specific instructions that guide Murph's runtime behavior.
---

# Extending Skills

Skills are Markdown instruction files with frontmatter. They teach Murph when and how to use a source, tool, workflow, or evidence type.

## File location

Shipped runtime skills live in the app's `skills/` directory. User-created runtime skills live in:

```text
~/.murph/skills/*.md
```

Murph loads shipped skills first, then user skills. A user skill with the same `name` overrides the shipped skill.

## File shape

```md
---
name: linear
description: Use Linear evidence for issue, project, cycle, and blocker questions.
knowledgeDomains: [work_item]
contextSourceNames: [linear.thread_search]
groundingPolicy: prefer_search
priority: 20
riskLevel: low
---

Use Linear evidence when the request mentions issues, projects, cycles, blockers, or roadmap status.
Prefer issue titles, current status, assignee, labels, and recent comments over memory.
```

## Frontmatter

| Field | Purpose |
| --- | --- |
| `name` | Stable skill id. Defaults to the filename when omitted. |
| `description` | Selection hint for when the skill is relevant. |
| `knowledgeDomains` | Domains the skill applies to, such as `work_item` or `code`. |
| `contextSourceNames` | Context sources the skill expects or prefers. |
| `channelNames` | Channel providers where this skill applies. |
| `sessionModes` | Session modes where this skill applies. |
| `groundingPolicy` | `model_choice`, `prefer_search`, or `required_when_no_artifacts`. |
| `priority` | Higher priority skills are considered first. Default is `10`. |
| `riskLevel` | `low`, `medium`, or `high`. Default is `low`. |

## Priority

Use priority to resolve overlap:

- `10`: normal source guidance.
- `20`: important source-specific workflow.
- `30+`: narrow high-priority operational behavior.

Avoid making broad skills high priority. They can crowd out more specific instructions.

## Grounding policy

Use `prefer_search` when search is usually helpful but not mandatory.

Use `required_when_no_artifacts` when Murph should retrieve source evidence before answering factual questions if no current artifacts already exist.

Use `model_choice` for style, routing, or interpretation guidance that does not require retrieval.

## Instructions

The body should be operational, not promotional. Include:

- what evidence to prefer;
- what claims require grounding;
- what to avoid;
- when to queue or ask instead of answering;
- source-specific terms users are likely to use.

Keep one skill focused on one source or workflow. Create separate skills when priorities, risk, or grounding expectations differ.
