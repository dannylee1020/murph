import { describe, expect, it } from 'vitest';
import {
  builtinPolicyProfile,
  compilePolicy,
  compilePolicyOverride,
  mergeCompiledPolicy,
  resolveEffectivePolicy
} from '../src/lib/server/runtime/policy-compiler';

describe('policy compiler', () => {
  it('builds a mode-aware built-in fallback profile', () => {
    const profile = builtinPolicyProfile('manual_review');
    expect(profile.name).toBe('builtin-manual_review');
    expect(profile.compiled.allowAutoSend).toBe(false);
    expect(profile.compiled.requireGroundingForFacts).toBe(true);
  });

  it('compiles full policy text with conservative defaults', () => {
    const { compiled, warnings } = compilePolicy('keep it tight and careful', 'auto_send_low_risk');
    expect(warnings[0]).toMatch(/defaults/);
    expect(compiled.requireGroundingForFacts).toBe(true);
    expect(compiled.preferAskWhenUncertain).toBe(true);
    expect(compiled.allowAutoSend).toBe(true);
  });

  it('parses override patches without clobbering unrelated fields', () => {
    const base = builtinPolicyProfile('auto_send_low_risk').compiled;
    const { patch } = compilePolicyOverride('Always queue: pricing\nAllow auto-send: no');
    const merged = mergeCompiledPolicy(base, patch);

    expect(merged.alwaysQueueTopics).toContain('pricing');
    expect(merged.requireGroundingForFacts).toBe(base.requireGroundingForFacts);
    expect(merged.allowAutoSend).toBe(false);
  });

  it('resolves profile plus override into one effective compiled policy', () => {
    const base = {
      name: 'test',
      description: 'desc',
      source: 'filesystem' as const,
      compiled: {
        blockedTopics: ['legal'],
        alwaysQueueTopics: ['launch decisions'],
        blockedActions: [],
        requireGroundingForFacts: true,
        preferAskWhenUncertain: true,
        allowAutoSend: false,
        notesForAgent: []
      }
    };

    const resolved = resolveEffectivePolicy({
      mode: 'manual_review',
      baseProfile: base,
      overrideRaw: 'Block topics: payroll'
    });

    expect(resolved.profile.name).toBe('test');
    expect(resolved.compiled.blockedTopics).toEqual(expect.arrayContaining(['legal', 'payroll']));
  });
});
