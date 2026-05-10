import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadPolicyProfiles, normalizePolicyProfileName } from '../src/lib/server/policies/loader';

describe('policy profile loader', () => {
  it('loads markdown profiles from disk', async () => {
    const root = mkdtempSync(join(tmpdir(), 'murph-policies-'));
    writeFileSync(
      join(root, 'test.md'),
      [
        'name: launch-manager',
        'description: Launch manager profile',
        'blockedTopics: legal',
        'alwaysQueueTopics: launch decisions',
        'allowAutoSend: no',
        'requireGroundingForFacts: yes',
        'preferAskWhenUncertain: yes',
        '---',
        'Use calm release language.'
      ].join('\n')
    );

    const profiles = await loadPolicyProfiles(root);
    expect(profiles).toHaveLength(1);
    expect(profiles[0].name).toBe('launch-manager');
    expect(profiles[0].compiled.blockedTopics).toContain('legal');
    expect(profiles[0].compiled.notesForAgent[0]).toMatch(/Use calm release language/);
  });

  it('ignores README examples and de-duplicates profile names', async () => {
    const root = mkdtempSync(join(tmpdir(), 'murph-policies-'));
    const profile = [
      'name: leadership',
      'description: Real leadership profile',
      'allowAutoSend: no',
      '---',
      'Use a cautious tone.'
    ].join('\n');

    writeFileSync(join(root, 'leadership.md'), profile);
    writeFileSync(
      join(root, 'README.md'),
      [
        'name: leadership',
        'description: Example leadership profile',
        '---',
        'This is documentation, not a real profile.'
      ].join('\n')
    );
    writeFileSync(join(root, 'copy.md'), profile);

    const profiles = await loadPolicyProfiles(root);

    expect(profiles.map((item) => item.name)).toEqual(['leadership']);
    expect(profiles[0].description).toBe('Real leadership profile');
  });

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
