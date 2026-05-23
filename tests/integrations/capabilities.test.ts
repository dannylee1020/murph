import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

async function setup(options: { notionApiKey?: string } = {}) {
  vi.resetModules();
  const root = mkdtempSync(join(tmpdir(), 'murph-capabilities-'));
  process.env.MURPH_SQLITE_PATH = join(root, 'murph.sqlite');
  process.env.MURPH_CONFIG_PATH = join(root, 'config.yaml');
  process.env.MURPH_CREDENTIALS_PATH = join(root, '.credentials');
  process.env.MURPH_ENCRYPTION_KEY = 'test-key';
  // Set explicitly, even to empty string, so this test does not read local credentials.
  process.env.NOTION_API_KEY = options.notionApiKey ?? '';
  process.env.GITHUB_PAT = '';
  process.env.GOOGLE_ACCESS_TOKEN = '';
  process.env.GRANOLA_API_KEY = '';
  process.env.OBSIDIAN_VAULT_PATH = '';

  const { getStore } = await import('#lib/server/persistence/store');
  const store = getStore();
  const workspace = store.saveInstall({
    provider: 'slack',
    externalWorkspaceId: 'T1',
    name: 'Test Workspace',
    botUserId: 'UTZBOT'
  });

  return { store, workspace };
}

describe('integration capability wiring', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    process.env.NOTION_API_KEY = '';
  });

  it('enableIntegrationCapabilities unions notion tools and context sources into workspace memory', async () => {
    const { store, workspace } = await setup();
    const { enableIntegrationCapabilities } = await import('#lib/server/integrations/capabilities');
    const { INTEGRATIONS } = await import('#lib/server/integrations/registry');
    const notion = INTEGRATIONS.find((i) => i.provider === 'notion')!;

    enableIntegrationCapabilities(workspace.id, notion);

    const memory = store.getOrCreateWorkspaceMemory(workspace.id);
    expect(memory.enabledOptionalTools).toEqual(expect.arrayContaining(notion.tools));
    expect(memory.enabledContextSources).toEqual(expect.arrayContaining(notion.contextSources));
  });

  it('disableIntegrationCapabilities removes the integration tools and sources', async () => {
    const { store, workspace } = await setup();
    const { enableIntegrationCapabilities, disableIntegrationCapabilities } = await import(
      '#lib/server/integrations/capabilities'
    );
    const { INTEGRATIONS } = await import('#lib/server/integrations/registry');
    const notion = INTEGRATIONS.find((i) => i.provider === 'notion')!;

    enableIntegrationCapabilities(workspace.id, notion);
    disableIntegrationCapabilities(workspace.id, notion);

    const memory = store.getOrCreateWorkspaceMemory(workspace.id);
    for (const tool of notion.tools) {
      expect(memory.enabledOptionalTools).not.toContain(tool);
    }
    for (const source of notion.contextSources) {
      expect(memory.enabledContextSources).not.toContain(source);
    }
  });

  it('reconcileIntegrationCapabilitiesForWorkspace waits for GitHub repositories before enabling retrieval', async () => {
    const { store, workspace } = await setup();
    const { writeSecret } = await import('#lib/server/credentials/local-store');
    writeSecret('github', 'api_key', 'github-token', {
      metadata: { account: 'octo-user', repositories: [] }
    });
    store.saveIntegrationConnection({
      workspaceId: workspace.id,
      provider: 'github',
      credentialKind: 'api_key',
      metadata: { account: 'octo-user', repositories: [] }
    });
    const { reconcileIntegrationCapabilitiesForWorkspace } = await import(
      '#lib/server/integrations/capabilities'
    );

    reconcileIntegrationCapabilitiesForWorkspace(workspace.id);

    const memory = store.getOrCreateWorkspaceMemory(workspace.id);
    expect(memory.enabledOptionalTools).not.toContain('github.search');
    expect(memory.enabledContextSources).not.toContain('github.thread_search');
  });

  it('reconcileIntegrationCapabilitiesForWorkspace enables GitHub when repositories are selected', async () => {
    const { store, workspace } = await setup();
    const { writeSecret } = await import('#lib/server/credentials/local-store');
    writeSecret('github', 'api_key', 'github-token', {
      metadata: { account: 'octo-user', repositories: ['octo/app'] }
    });
    store.saveIntegrationConnection({
      workspaceId: workspace.id,
      provider: 'github',
      credentialKind: 'api_key',
      metadata: { account: 'octo-user', repositories: ['octo/app'] }
    });
    const { reconcileIntegrationCapabilitiesForWorkspace } = await import(
      '#lib/server/integrations/capabilities'
    );

    reconcileIntegrationCapabilitiesForWorkspace(workspace.id);

    const memory = store.getOrCreateWorkspaceMemory(workspace.id);
    expect(memory.enabledOptionalTools).toContain('github.search');
    expect(memory.enabledContextSources).toContain('github.thread_search');
  });

  it('reconcileIntegrationCapabilitiesForWorkspace ignores legacy scoped credentials', async () => {
    const { store, workspace } = await setup();
    const discordWorkspace = store.saveInstall({
      provider: 'discord',
      externalWorkspaceId: 'G1',
      name: 'Test Guild',
      botUserId: 'DBOT'
    });
    const { writeSecret, readSecret } = await import('#lib/server/credentials/local-store');
    writeSecret('notion', 'api_key', 'notion-token', {
      workspaceId: workspace.id,
      metadata: { account: 'murph-adapter' }
    });
    store.saveIntegrationConnection({
      workspaceId: workspace.id,
      provider: 'notion',
      credentialKind: 'api_key',
      metadata: { account: 'murph-adapter' }
    });
    const { reconcileIntegrationCapabilitiesForWorkspace } = await import(
      '#lib/server/integrations/capabilities'
    );

    reconcileIntegrationCapabilitiesForWorkspace(discordWorkspace.id);

    expect(readSecret('notion', 'api_key')).toBeUndefined();
    const memory = store.getOrCreateWorkspaceMemory(discordWorkspace.id);
    expect(memory.enabledOptionalTools).not.toContain('notion.search');
    expect(memory.enabledOptionalTools).not.toContain('notion.read_page');
    expect(memory.enabledContextSources).not.toContain('notion.thread_search');
  });

  it('reconcileIntegrationCapabilitiesForWorkspace enables tools from env fallback', async () => {
    const { store, workspace } = await setup({ notionApiKey: 'env-notion-token' });
    const { reconcileIntegrationCapabilitiesForWorkspace } = await import(
      '#lib/server/integrations/capabilities'
    );

    reconcileIntegrationCapabilitiesForWorkspace(workspace.id);

    const memory = store.getOrCreateWorkspaceMemory(workspace.id);
    expect(memory.enabledOptionalTools).toContain('notion.search');
    expect(memory.enabledOptionalTools).toContain('notion.read_page');
    expect(memory.enabledContextSources).toContain('notion.thread_search');
  });

  it('reconcileIntegrationCapabilitiesForWorkspace enables Obsidian from a configured vault path', async () => {
    const { store, workspace } = await setup();
    const root = mkdtempSync(join(tmpdir(), 'murph-obsidian-capabilities-'));
    process.env.OBSIDIAN_VAULT_PATH = root;
    const { registerBuiltInIntegrationAdapters } = await import('#lib/server/integrations/register-builtins');
    registerBuiltInIntegrationAdapters();
    const { reconcileIntegrationCapabilitiesForWorkspace } = await import(
      '#lib/server/integrations/capabilities'
    );

    reconcileIntegrationCapabilitiesForWorkspace(workspace.id);

    const memory = store.getOrCreateWorkspaceMemory(workspace.id);
    expect(memory.enabledOptionalTools).toEqual(expect.arrayContaining(['obsidian.search', 'obsidian.read_note']));
    expect(memory.enabledContextSources).toContain('obsidian.thread_search');
  });

  it('reconcileIntegrationCapabilitiesForWorkspace enables Slack channel tools without integration credentials', async () => {
    const { store, workspace } = await setup();
    const { reconcileIntegrationCapabilitiesForWorkspace } = await import(
      '#lib/server/integrations/capabilities'
    );

    reconcileIntegrationCapabilitiesForWorkspace(workspace.id);

    const memory = store.getOrCreateWorkspaceMemory(workspace.id);
    expect(memory.enabledOptionalTools).toEqual(expect.arrayContaining(['slack.search', 'slack.read_thread']));
    expect(memory.enabledContextSources).toEqual(expect.arrayContaining(['slack.thread_search']));
    expect(memory.enabledOptionalTools).not.toContain('notion.search');
    expect(memory.enabledContextSources).not.toContain('notion.thread_search');
  });
});
