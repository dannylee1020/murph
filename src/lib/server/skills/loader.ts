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

function parseYamlValue(raw: string): string | number | string[] {
  const trimmed = raw.trim();

  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    return trimmed
      .slice(1, -1)
      .split(',')
      .map((item) => item.trim().replace(/^['"]|['"]$/g, ''))
      .filter(Boolean);
  }

  const num = Number(trimmed);
  if (Number.isFinite(num) && trimmed !== '') {
    return num;
  }

  return trimmed;
}

function parseFrontmatter(header: string): Record<string, string | number | string[]> {
  const result: Record<string, string | number | string[]> = {};

  for (const line of header.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed === '---') continue;

    const colonIdx = trimmed.indexOf(':');
    if (colonIdx === -1) continue;

    const key = trimmed.slice(0, colonIdx).trim();
    const value = trimmed.slice(colonIdx + 1).trim();
    if (!key) continue;

    result[key] = parseYamlValue(value);
  }

  return result;
}

function asStringArray(value: string | number | string[] | undefined): string[] {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    return value.split(',').map((item) => item.trim()).filter(Boolean);
  }
  return [];
}

function asString(value: string | number | string[] | undefined): string | undefined {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  return undefined;
}

function asNumber(value: string | number | string[] | undefined, fallback: number): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  return fallback;
}

function parseGroundingPolicy(value: string | undefined): SkillManifest['groundingPolicy'] {
  return value === 'prefer_search' || value === 'required_when_no_artifacts' ? value : 'model_choice';
}

async function parseSkillFile(filePath: string): Promise<SkillManifest | null> {
  const content = await readFile(filePath, 'utf8');
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);

  if (!match) {
    const [header, ...rest] = content.split('\n---\n');
    if (!rest.length) return null;
    const metadata = parseFrontmatter(header);
    return buildManifest(metadata, rest.join('\n---\n').trim(), filePath);
  }

  const metadata = parseFrontmatter(match[1]);
  return buildManifest(metadata, match[2].trim(), filePath);
}

function buildManifest(
  metadata: Record<string, string | number | string[]>,
  instructions: string,
  filePath: string
): SkillManifest {
  const riskLevel = asString(metadata.riskLevel);

  return {
    name: asString(metadata.name) ?? path.basename(filePath, '.md'),
    description: asString(metadata.description) ?? 'No description provided.',
    knowledgeDomains: asStringArray(metadata.knowledgeDomains),
    groundingPolicy: parseGroundingPolicy(asString(metadata.groundingPolicy)),
    channelNames: asStringArray(metadata.channelNames),
    sessionModes: asStringArray(metadata.sessionModes) as SkillManifest['sessionModes'],
    contextSourceNames: asStringArray(metadata.contextSourceNames),
    priority: asNumber(metadata.priority, 10),
    riskLevel: riskLevel === 'medium' || riskLevel === 'high' ? riskLevel : 'low',
    instructions
  };
}
