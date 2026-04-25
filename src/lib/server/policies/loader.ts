import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { POLICIES_ROOT } from '#lib/config';
import type { CompiledPolicy, PolicyProfile } from '#lib/types';

function parseCsv(value?: string): string[] {
  return value ? value.split(',').map((item) => item.trim()).filter(Boolean) : [];
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  return value ? /^(yes|true)$/i.test(value.trim()) : fallback;
}

function parseCompiledPolicy(metadata: Record<string, string>, body: string): CompiledPolicy {
  const bodyNotes = body
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  return {
    blockedTopics: parseCsv(metadata.blockedTopics).map((item) => item.toLowerCase()),
    alwaysQueueTopics: parseCsv(metadata.alwaysQueueTopics).map((item) => item.toLowerCase()),
    blockedActions: parseCsv(metadata.blockedActions) as CompiledPolicy['blockedActions'],
    requireGroundingForFacts: parseBoolean(metadata.requireGroundingForFacts, true),
    preferAskWhenUncertain: parseBoolean(metadata.preferAskWhenUncertain, true),
    allowAutoSend: parseBoolean(metadata.allowAutoSend, false),
    notesForAgent: [...parseCsv(metadata.notes).map((item) => item.toLowerCase()), ...bodyNotes]
  };
}

async function parsePolicyFile(filePath: string): Promise<PolicyProfile | null> {
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

  return {
    name: metadata.name ?? path.basename(filePath, '.md'),
    description: metadata.description ?? 'No description provided.',
    compiled: parseCompiledPolicy(metadata, rest.join('\n---\n').trim()),
    source: 'filesystem',
    filePath
  };
}

export async function loadPolicyProfiles(root = POLICIES_ROOT): Promise<PolicyProfile[]> {
  try {
    const entries = await readdir(root);
    const profiles = await Promise.all(
      entries
        .filter((entry) => entry.endsWith('.md'))
        .map(async (entry) => parsePolicyFile(path.join(root, entry)))
    );
    return profiles
      .filter((profile): profile is PolicyProfile => profile !== null)
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return [];
  }
}
