import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

function installBrowserGlobals(): void {
  const storage = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => {
      storage.set(key, value);
    },
    removeItem: (key: string) => {
      storage.delete(key);
    }
  });
  vi.stubGlobal('window', {
    matchMedia: () => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn()
    })
  });
  vi.stubGlobal('document', {
    documentElement: { dataset: {} },
    querySelector: () => ({
      innerHTML: '',
      querySelector: () => null,
      querySelectorAll: () => [],
      addEventListener: vi.fn()
    })
  });
}

describe('page helpers', () => {
  beforeEach(() => {
    vi.resetModules();
    installBrowserGlobals();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders env-backed integrations as server env connections', async () => {
    const { integrationCard } = await import('../../app/ui/features/page-helpers');

    const html = integrationCard({
      provider: 'github',
      name: 'GitHub',
      description: 'Issues, pull requests, and repository context.',
      authType: 'api_key',
      credentialLabel: 'Personal access token',
      status: 'connected',
      source: 'env',
      envKey: 'GITHUB_PAT',
      tools: ['github.search'],
      contextSources: ['github.thread_search'],
      canDisconnect: false,
      metadata: {
        masked: '****oken',
        repositories: ['octo/app'],
        needsRepoScope: false
      }
    }, 'workspace-1');

    expect(html).toContain('Connected from server env');
    expect(html).toContain('<code>GITHUB_PAT</code>');
    expect(html).not.toContain('Set on this server');
  });
});
