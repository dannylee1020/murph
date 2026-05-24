import { describe, expect, it } from 'vitest';
import { loadPolicyProfiles, normalizePolicyProfileName } from '../src/lib/server/policies/loader';

describe('policy profile loader', () => {
  it('loads shipped role profiles with auto-send disabled', async () => {
    const profiles = await loadPolicyProfiles();
    const names = profiles.map((profile) => profile.name);
    const shippedNames = ['default', 'engineering', 'leadership', 'marketing', 'product', 'sales', 'yolo'];

    expect(names).toEqual(expect.arrayContaining(shippedNames));
    expect(profiles.filter((profile) => shippedNames.includes(profile.name) && profile.name !== 'yolo').every((profile) => profile.compiled.allowAutoSend === false)).toBe(true);
    expect(profiles.find((profile) => profile.name === 'engineering')?.compiled.alwaysQueueTopics).toContain('production incidents');
    expect(profiles.find((profile) => profile.name === 'sales')?.compiled.alwaysQueueTopics).toContain('contract terms');
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
    expect(normalizePolicyProfileName('founder-coverage')).toBe('leadership');
    expect(normalizePolicyProfileName('product-coverage')).toBe('product');
    expect(normalizePolicyProfileName(' engineering ')).toBe('engineering');
  });
});
