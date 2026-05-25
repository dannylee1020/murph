import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { POLICIES_ROOT } from '#lib/config';
import { userPolicyRoot } from '#lib/server/setup/paths';
import {
  normalizeCompiledPolicy,
  normalizePolicyExecutionMode,
  policyExecutionModeFromAllowAutoSend,
  normalizeScopedPolicyRules
} from '#lib/server/runtime/policy-compiler';
import type { CompiledPolicy, PolicyProfile } from '#lib/types';

const POLICY_PROFILE_ALIASES: Record<string, string> = {
  'founder-coverage': 'investor',
  leadership: 'investor',
  marketing: 'default',
  'product-coverage': 'product',
  sales: 'default'
};

export function normalizePolicyProfileName(name?: string): string | undefined {
  const normalized = name?.trim();
  if (!normalized) return undefined;
  return POLICY_PROFILE_ALIASES[normalized] ?? normalized;
}

function parseCsv(value?: string): string[] {
  return value ? value.split(',').map((item) => item.trim()).filter(Boolean) : [];
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  return value ? /^(yes|true)$/i.test(value.trim()) : fallback;
}

function parseJson(value: string | undefined): unknown {
  if (!value) return undefined;
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function parseCompiledPolicy(metadata: Record<string, string>, body: string): CompiledPolicy {
  const bodyNotes = body
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  const legacyAllowAutoSend = parseBoolean(metadata.allowAutoSend, false);
  const executionMode =
    normalizePolicyExecutionMode(metadata.mode ?? metadata.executionMode) ??
    policyExecutionModeFromAllowAutoSend(legacyAllowAutoSend);

  return normalizeCompiledPolicy({
    blockedTopics: parseCsv(metadata.blockedTopics).map((item) => item.toLowerCase()),
    alwaysQueueTopics: parseCsv(metadata.alwaysQueueTopics).map((item) => item.toLowerCase()),
    blockedActions: parseCsv(metadata.blockedActions) as CompiledPolicy['blockedActions'],
    executionMode,
    requireGroundingForFacts: parseBoolean(metadata.requireGroundingForFacts, true),
    preferAskWhenUncertain: parseBoolean(metadata.preferAskWhenUncertain, true),
    allowAutoSend: executionMode === 'auto_send_low_risk',
    notesForAgent: [...parseCsv(metadata.notes).map((item) => item.toLowerCase()), ...bodyNotes],
    rules: normalizeScopedPolicyRules(parseJson(metadata.scopedRules))
  });
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

  const name = normalizePolicyProfileName(metadata.name) ?? normalizePolicyProfileName(path.basename(filePath, '.md'))!;

  return {
    name,
    description: metadata.description ?? 'No description provided.',
    compiled: parseCompiledPolicy(metadata, rest.join('\n---\n').trim()),
    source: 'filesystem',
    filePath
  };
}

function policyProfileRoots(root: string): string[] {
  return root === POLICIES_ROOT ? [POLICIES_ROOT, userPolicyRoot()] : [root];
}

async function loadPolicyProfilesFromRoot(root: string): Promise<PolicyProfile[]> {
  try {
    const entries = await readdir(root);
    const profiles = await Promise.all(
      entries
        .filter((entry) => entry.endsWith('.md') && entry.toLowerCase() !== 'readme.md')
        .map(async (entry) => parsePolicyFile(path.join(root, entry)))
    );
    return profiles.filter((profile): profile is PolicyProfile => profile !== null);
  } catch {
    return [];
  }
}

export async function loadPolicyProfiles(root = POLICIES_ROOT): Promise<PolicyProfile[]> {
  const uniqueProfiles = new Map<string, PolicyProfile>();

  for (const profileRoot of policyProfileRoots(root)) {
    const profiles = await loadPolicyProfilesFromRoot(profileRoot);
    for (const profile of profiles) {
      const normalizedName = normalizePolicyProfileName(profile.name)!;
      uniqueProfiles.set(normalizedName, { ...profile, name: normalizedName });
    }
  }

  return [...uniqueProfiles.values()].sort((a, b) => a.name.localeCompare(b.name));
}
