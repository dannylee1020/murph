import { mkdirSync, writeFileSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadSkills } from '../shared/server/skills/loader';

function writeSkill(root: string, name: string, extraHeader = '', priority = 10): void {
  writeFileSync(
    join(root, `${name}.md`),
    [
      '---',
      `name: ${name}`,
      'description: Test skill',
      'knowledgeDomains: [documentation]',
      extraHeader,
      `priority: ${priority}`,
      '---',
      '# Test Skill',
      '',
      'Use this skill for tests.'
    ].filter(Boolean).join('\n')
  );
}

describe('loadSkills groundingPolicy', () => {
  const originalMurphHome = process.env.MURPH_HOME;

  beforeEach(() => {
    process.env.MURPH_HOME = mkdtempSync(join(tmpdir(), 'murph-skills-home-'));
  });

  afterEach(() => {
    if (originalMurphHome === undefined) {
      delete process.env.MURPH_HOME;
    } else {
      process.env.MURPH_HOME = originalMurphHome;
    }
  });

  it('parses valid grounding policy metadata', async () => {
    const root = mkdtempSync(join(tmpdir(), 'murph-skills-'));
    mkdirSync(root, { recursive: true });
    writeSkill(root, 'required-docs', 'groundingPolicy: required_when_no_artifacts');

    const skills = await loadSkills(root);

    expect(skills[0]?.groundingPolicy).toBe('required_when_no_artifacts');
  });

  it('loads user skills from Murph home and lets them override shipped skills', async () => {
    const userRoot = join(process.env.MURPH_HOME!, 'skills');
    mkdirSync(userRoot, { recursive: true });
    writeSkill(userRoot, 'custom-user-skill', '', 50);
    writeSkill(userRoot, 'github-code', '', 99);

    const skills = await loadSkills();

    expect(skills.find((skill) => skill.name === 'custom-user-skill')?.priority).toBe(50);
    expect(skills.find((skill) => skill.name === 'github-code')?.priority).toBe(99);
  });

  it('loads the built-in Obsidian vault skill with its context source requirement', async () => {
    const skills = await loadSkills();

    expect(skills.find((skill) => skill.name === 'obsidian-vault')).toEqual(expect.objectContaining({
      knowledgeDomains: ['documentation', 'meeting'],
      groundingPolicy: 'required_when_no_artifacts',
      contextSourceNames: ['obsidian.thread_search'],
      priority: 108
    }));
  });
});
