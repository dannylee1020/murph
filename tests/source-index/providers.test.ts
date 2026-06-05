import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('source index provider resolution', () => {
  beforeEach(() => {
    vi.resetModules();
    delete process.env.MURPH_DISTRIBUTION;
  });

  it('uses only team-available non-Google providers in team runtime', async () => {
    process.env.MURPH_DISTRIBUTION = 'team';
    const { sourceIndexProviderIdsForCurrentRuntime } = await import('../../app/server/source-index/providers');

    expect(sourceIndexProviderIdsForCurrentRuntime()).toEqual(['github', 'notion', 'linear']);
  });

  it('keeps team providers when personal runtime is requested', async () => {
    process.env.MURPH_DISTRIBUTION = 'personal';
    const { sourceIndexProviderIdsForCurrentRuntime } = await import('../../app/server/source-index/providers');

    expect(sourceIndexProviderIdsForCurrentRuntime()).toEqual(['github', 'notion', 'linear']);
  });

  it('rejects Google in the team-only runtime', async () => {
    process.env.MURPH_DISTRIBUTION = 'personal';
    const { validateSourceIndexProvidersForCurrentRuntime } = await import('../../app/server/source-index/providers');

    expect(() => validateSourceIndexProvidersForCurrentRuntime(['google'])).toThrow(/Unsupported source index provider: google/);
  });
});
