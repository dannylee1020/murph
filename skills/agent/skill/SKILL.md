---
name: skill
description: Create or revise Murph runtime skills and Murph Agent Pi skills. Use when the operator asks to add guidance, skills, or behavior instructions.
---

# Skill

Use this skill when working with Murph skills.

## Distinguish Skill Types

- Murph runtime skills guide the async messenger runtime. They are Markdown manifests in core `skills/runtime/*.md` or plugin `capabilities.skills`.
- Murph Agent skills are Pi skills for `murph agent`. Active skills live under `~/.murph/pi-agent/skills/<name>/SKILL.md`.
- Built-in skill templates are bundled under `<murph app>/skills/agent/<name>/SKILL.md` and synced into the active directory.

## Runtime Skill Workflow

1. Search `docs/docs/plugins/skills.md` with `murph_docs_search`.
2. Keep each runtime skill focused on one source, integration, or evidence type.
3. Include frontmatter such as `name`, `description`, `knowledgeDomains`, `contextSourceNames`, and `priority` when relevant.
4. Add runtime skills through scoped plugins when possible.
5. Reload plugins after changing plugin-provided skills.

## Pi Skill Workflow

1. Use a directory named exactly like the skill name.
2. Put required frontmatter and instructions in `SKILL.md`.
3. Keep the description specific because Pi uses it to decide when to load the skill.
4. Use relative links for references, scripts, and assets inside the skill directory.
