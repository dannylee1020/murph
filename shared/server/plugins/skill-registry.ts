import type { SkillManifest } from '#shared/types';

const skills = new Map<string, SkillManifest>();

export function registerScopedPluginSkill(skill: SkillManifest): void {
  if (skills.has(skill.name)) {
    throw new Error(`Skill already registered: ${skill.name}`);
  }

  skills.set(skill.name, skill);
}

export function listScopedPluginSkills(): SkillManifest[] {
  return [...skills.values()];
}

export function clearScopedPluginSkills(): void {
  skills.clear();
}
