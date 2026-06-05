import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadPolicyProfiles, normalizePolicyProfileName } from '../app/server/policies/loader';

function writePolicy(root: string, name: string, description = 'Test policy'): void {
  writeFileSync(
    join(root, `${name}.md`),
    [
      `name: ${name}`,
      `description: ${description}`,
      'blockedTopics:',
      'alwaysQueueTopics: custom review',
      'blockedActions:',
      'mode: manual_review',
      'allowAutoSend: no',
      'requireGroundingForFacts: yes',
      'preferAskWhenUncertain: yes',
      'notes: user policy note',
      '---',
      'User policy body.'
    ].join('\n')
  );
}

describe('policy profile loader', () => {
  const originalMurphHome = process.env.MURPH_HOME;

  beforeEach(() => {
    process.env.MURPH_HOME = mkdtempSync(join(tmpdir(), 'murph-policy-home-'));
  });

  afterEach(() => {
    if (originalMurphHome === undefined) {
      delete process.env.MURPH_HOME;
    } else {
      process.env.MURPH_HOME = originalMurphHome;
    }
  });

  it('loads shipped role profiles with auto-send disabled', async () => {
    const profiles = await loadPolicyProfiles();
    const names = profiles.map((profile) => profile.name);
    const shippedNames = ['default', 'engineering', 'investor', 'product', 'yolo'];

    expect(names).toEqual(expect.arrayContaining(shippedNames));
    expect(names).not.toEqual(expect.arrayContaining(['leadership', 'marketing', 'sales']));
    expect(profiles.filter((profile) => shippedNames.includes(profile.name) && profile.name !== 'yolo').every((profile) => profile.compiled.allowAutoSend === false)).toBe(true);
    expect(profiles.find((profile) => profile.name === 'engineering')?.compiled.alwaysQueueTopics).toContain('production incidents');
    expect(profiles.find((profile) => profile.name === 'investor')?.compiled.alwaysQueueTopics).toContain('investor updates');
  });

  it('loads yolo as an explicit maximum-autonomy profile', async () => {
    const profiles = await loadPolicyProfiles();
    const yolo = profiles.find((profile) => profile.name === 'yolo');

    expect(yolo?.compiled).toEqual(expect.objectContaining({
      allowAutoSend: true,
      requireGroundingForFacts: true,
      preferAskWhenUncertain: false,
      blockedTopics: [],
      alwaysQueueTopics: [],
      blockedActions: [],
      notesForAgent: expect.arrayContaining([
        expect.stringContaining('read-only retrieval and context tool')
      ])
    }));
  });

  it('normalizes legacy shipped profile names', () => {
    expect(normalizePolicyProfileName('founder-coverage')).toBe('investor');
    expect(normalizePolicyProfileName('leadership')).toBe('investor');
    expect(normalizePolicyProfileName('marketing')).toBe('default');
    expect(normalizePolicyProfileName('product-coverage')).toBe('product');
    expect(normalizePolicyProfileName('sales')).toBe('default');
    expect(normalizePolicyProfileName(' engineering ')).toBe('engineering');
  });

  it('loads user policies from Murph home and lets them override shipped profiles', async () => {
    const policyRoot = join(process.env.MURPH_HOME!, 'policies');
    mkdirSync(policyRoot, { recursive: true });
    writePolicy(policyRoot, 'custom');
    writePolicy(policyRoot, 'engineering', 'User engineering override');

    const profiles = await loadPolicyProfiles();

    expect(profiles.find((profile) => profile.name === 'custom')?.description).toBe('Test policy');
    expect(profiles.find((profile) => profile.name === 'engineering')?.description).toBe('User engineering override');
  });
});
