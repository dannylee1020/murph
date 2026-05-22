---
title: Skills
description: Add Murph behavior instructions with plugin skills.
---

# Skills

Skills describe how Murph should use a specific integration, connector, or evidence source.

## Skill file

Plugin skills are Markdown files with frontmatter and instructions.

```md
---
name: linear
description: Use Linear evidence for issue, project, cycle, and blocker questions.
knowledgeDomains: [work_item]
contextSourceNames: [linear.thread_search]
priority: 20
---

Use Linear evidence when the request mentions issues, projects, cycles, or blockers.
```

## Name

`name` identifies the skill inside Murph. Skill names should be stable and unique.

## Description

`description` tells Murph when the skill is relevant.

## Priority

`priority` controls ordering when multiple skills apply. Higher priority skills are considered first.

## Instructions

The Markdown body tells Murph how to interpret and use that source. Keep it specific to one integration or connector.
