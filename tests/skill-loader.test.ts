import { mkdirSync, writeFileSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadSkills } from '../src/lib/server/skills/loader';

function writeSkill(root: string, name: string, extraHeader = ''): void {
  writeFileSync(
    join(root, `${name}.md`),
    [
      `name: ${name}`,
      'description: Test skill',
      'triggers: test',
      'allowedActions: reply, ask, redirect, defer, remind, abstain',
      'toolNames: channel.fetch_thread',
      'knowledgeDomains: documentation',
      extraHeader,
      'channelNames: slack',
      'knowledgeRequirements: test',
      'sessionModes: manual_review',
      'appliesTo: channel_thread',
      'priority: 10',
      'riskLevel: low',
      'abstainConditions: none',
      '---',
      '# Test Skill',
      '',
      'Use this skill for tests.'
    ].filter(Boolean).join('\n')
  );
}

describe('loadSkills groundingPolicy', () => {
  it('parses valid grounding policy metadata', async () => {
    const root = mkdtempSync(join(tmpdir(), 'murph-skills-'));
    mkdirSync(root, { recursive: true });
    writeSkill(root, 'required-docs', 'groundingPolicy: required_when_no_artifacts');

    const skills = await loadSkills(root);

    expect(skills[0]?.groundingPolicy).toBe('required_when_no_artifacts');
  });

  it('defaults missing grounding policy to model_choice', async () => {
    const root = mkdtempSync(join(tmpdir(), 'murph-skills-'));
    mkdirSync(root, { recursive: true });
    writeSkill(root, 'default-docs');

    const skills = await loadSkills(root);

    expect(skills[0]?.groundingPolicy).toBe('model_choice');
  });

  it('defaults invalid grounding policy to model_choice', async () => {
    const root = mkdtempSync(join(tmpdir(), 'murph-skills-'));
    mkdirSync(root, { recursive: true });
    writeSkill(root, 'invalid-docs', 'groundingPolicy: always_search');

    const skills = await loadSkills(root);

    expect(skills[0]?.groundingPolicy).toBe('model_choice');
  });
});
