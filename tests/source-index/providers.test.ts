import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('source index provider resolution', () => {
  beforeEach(() => {
    vi.resetModules();
    delete process.env.MURPH_DISTRIBUTION;
  });

  it('uses only team-available non-Google providers in team runtime', async () => {
    process.env.MURPH_DISTRIBUTION = 'team';
    const { sourceIndexProviderIdsForCurrentRuntime } = await import('../../shared/server/source-index/providers');

    expect(sourceIndexProviderIdsForCurrentRuntime()).toEqual(['github', 'notion', 'linear']);
  });

  it('uses personal-available non-Google providers in personal runtime', async () => {
    process.env.MURPH_DISTRIBUTION = 'personal';
    const { sourceIndexProviderIdsForCurrentRuntime } = await import('../../shared/server/source-index/providers');

    expect(sourceIndexProviderIdsForCurrentRuntime()).toEqual(['github', 'notion', 'linear', 'granola', 'obsidian']);
  });

  it('rejects Google even when it is available in personal runtime', async () => {
    process.env.MURPH_DISTRIBUTION = 'personal';
    const { validateSourceIndexProvidersForCurrentRuntime } = await import('../../shared/server/source-index/providers');

    expect(() => validateSourceIndexProvidersForCurrentRuntime(['google'])).toThrow(/Unsupported source index provider: google/);
  });
});
