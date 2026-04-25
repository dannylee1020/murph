import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { SKILLS_ROOT } from '#lib/config';
import { listRegisteredPluginSkills } from '#lib/server/capabilities/plugins';
import type { SkillManifest } from '#lib/types';

export async function loadSkills(root = SKILLS_ROOT): Promise<SkillManifest[]> {
  try {
    const entries = await readdir(root);
    const fileSkills = await Promise.all(
      entries
        .filter((entry) => entry.endsWith('.md'))
        .map(async (entry) => parseSkillFile(path.join(root, entry)))
    );
    const skills = fileSkills.filter((skill): skill is SkillManifest => skill !== null);
    const merged = new Map(skills.map((skill) => [skill.name, skill]));

    for (const skill of listRegisteredPluginSkills()) {
      merged.set(skill.name, skill);
    }

    return [...merged.values()].sort((a, b) => b.priority - a.priority);
  } catch {
    return listRegisteredPluginSkills().sort((a, b) => b.priority - a.priority);
  }
}

function parseCsv(value?: string): string[] {
  return value ? value.split(',').map((item) => item.trim()).filter(Boolean) : [];
}

function parseNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseGroundingPolicy(value: string | undefined): SkillManifest['groundingPolicy'] {
  return value === 'prefer_search' || value === 'required_when_no_artifacts' ? value : 'model_choice';
}

async function parseSkillFile(filePath: string): Promise<SkillManifest | null> {
  const content = await readFile(filePath, 'utf8');
  const [header, ...rest] = content.split('\n---\n');

  if (!rest.length) {
    return null;
  }

  const metadata = header
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .reduce<Record<string, string>>((acc, line) => {
      const [key, ...valueParts] = line.split(':');
      if (!key || valueParts.length === 0) {
        return acc;
      }

      acc[key.trim()] = valueParts.join(':').trim();
      return acc;
    }, {});

  const actionList = parseCsv(metadata.allowedActions);

  return {
    name: metadata.name ?? path.basename(filePath, '.md'),
    description: metadata.description ?? 'No description provided.',
    triggers: parseCsv(metadata.triggers),
    allowedActions: (actionList.length > 0 ? actionList : ['abstain']) as SkillManifest['allowedActions'],
    toolNames: parseCsv(metadata.toolNames),
    knowledgeDomains: parseCsv(metadata.knowledgeDomains),
    groundingPolicy: parseGroundingPolicy(metadata.groundingPolicy),
    channelNames: parseCsv(metadata.channelNames),
    contextSourceNames: parseCsv(metadata.contextSourceNames),
    knowledgeRequirements: parseCsv(metadata.knowledgeRequirements),
    sessionModes: parseCsv(metadata.sessionModes) as SkillManifest['sessionModes'],
    appliesTo: parseCsv(metadata.appliesTo),
    priority: parseNumber(metadata.priority, 10),
    riskLevel:
      metadata.riskLevel === 'medium' || metadata.riskLevel === 'high' ? metadata.riskLevel : 'low',
    abstainConditions: parseCsv(metadata.abstainConditions),
    instructions: rest.join('\n---\n').trim()
  };
}
