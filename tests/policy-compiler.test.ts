import { describe, expect, it } from 'vitest';
import {
  builtinPolicyProfile,
  compilePolicyOverride,
  mergeCompiledPolicy,
  resolveEffectivePolicy
} from '../src/lib/server/runtime/policy-compiler';

describe('policy compiler', () => {
  it('builds a mode-aware built-in fallback profile', () => {
    const profile = builtinPolicyProfile('manual_review');
    expect(profile.name).toBe('builtin-manual_review');
    expect(profile.compiled.executionMode).toBe('manual_review');
    expect(profile.compiled.allowAutoSend).toBe(false);
    expect(profile.compiled.requireGroundingForFacts).toBe(true);
  });

  it('parses override patches without clobbering unrelated fields', () => {
    const base = builtinPolicyProfile('auto_send_low_risk').compiled;
    const { patch } = compilePolicyOverride('Always queue: pricing\nAllow auto-send: no');
    const merged = mergeCompiledPolicy(base, patch);

    expect(merged.alwaysQueueTopics).toContain('pricing');
    expect(merged.requireGroundingForFacts).toBe(base.requireGroundingForFacts);
    expect(merged.executionMode).toBe('manual_review');
    expect(merged.allowAutoSend).toBe(false);
  });

  it('uses explicit policy mode over legacy allowAutoSend text', () => {
    const resolved = resolveEffectivePolicy({
      mode: 'manual_review',
      overrideRaw: 'Mode: auto_send_low_risk\nAllow auto-send: no'
    });

    expect(resolved.compiled.executionMode).toBe('auto_send_low_risk');
    expect(resolved.compiled.allowAutoSend).toBe(true);
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
        executionMode: 'manual_review' as const,
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

  it('normalizes scoped rules during resolution', () => {
    const resolved = resolveEffectivePolicy({
      mode: 'auto_send_low_risk',
      scopedRules: [
        {
          id: 'launch-review',
          name: 'Launch review',
          match: {
            channelIds: ['C-launch'],
            intents: ['status_request'],
            actionTypes: ['reply']
          },
          controls: {
            allowAutoSend: false,
            blockedTopics: ['Pricing']
          }
        },
        {
          id: 'empty-rule',
          name: 'Empty rule',
          controls: {}
        }
      ]
    });

    expect(resolved.compiled.rules).toHaveLength(1);
    expect(resolved.compiled.rules?.[0]).toMatchObject({
      id: 'launch-review',
      match: { channelIds: ['C-launch'], intents: ['status_request'], actionTypes: ['reply'] },
      controls: { allowAutoSend: false, blockedTopics: ['pricing'] }
    });
  });
});
