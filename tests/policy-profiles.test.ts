import { describe, expect, it } from 'vitest';
import { loadPolicyProfiles, normalizePolicyProfileName } from '../src/lib/server/policies/loader';

describe('policy profile loader', () => {
  it('loads shipped role profiles with auto-send disabled', async () => {
    const profiles = await loadPolicyProfiles();
    const names = profiles.map((profile) => profile.name);

    expect(names).toEqual(['default', 'engineering', 'leadership', 'marketing', 'product', 'sales']);
    expect(profiles.every((profile) => profile.compiled.allowAutoSend === false)).toBe(true);
    expect(profiles.find((profile) => profile.name === 'engineering')?.compiled.alwaysQueueTopics).toContain('production incidents');
    expect(profiles.find((profile) => profile.name === 'sales')?.compiled.alwaysQueueTopics).toContain('contract terms');
  });

  it('normalizes legacy shipped profile names', () => {
    expect(normalizePolicyProfileName('founder-coverage')).toBe('leadership');
    expect(normalizePolicyProfileName('product-coverage')).toBe('product');
    expect(normalizePolicyProfileName(' engineering ')).toBe('engineering');
  });
});
