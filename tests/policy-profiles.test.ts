import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadPolicyProfiles } from '../src/lib/server/policies/loader';

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
});
