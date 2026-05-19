---
title: Skills
description: Add Murph behavior instructions with plugin skills.
---

# Skills

Skills describe how Murph should handle a type of work.

## Skill file

Plugin skills are Markdown files with frontmatter and instructions.

```md
---
name: linear
description: Handle Linear-related work.
priority: 20
---

Use Linear context when the request mentions issues, projects, cycles, or blockers.
```

## Name

`name` identifies the skill inside Murph. Skill names should be stable and unique.

## Description

`description` tells Murph when the skill is relevant.

## Priority

`priority` controls ordering when multiple skills apply. Higher priority skills are considered first.

## Instructions

The Markdown body tells Murph how to handle the work. Keep it specific to one behavior.
