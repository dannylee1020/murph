import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

async function setup(options: { notionApiKey?: string } = {}) {
  vi.resetModules();
  process.env.MURPH_SQLITE_PATH = join(mkdtempSync(join(tmpdir(), 'murph-capabilities-')), 'murph.sqlite');
  process.env.MURPH_ENCRYPTION_KEY = 'test-key';
  // Set explicitly (even to empty string) so loadDotEnv leaves it alone — it only fills undefined.
  process.env.NOTION_API_KEY = options.notionApiKey ?? '';

  const { getStore } = await import('#lib/server/persistence/store');
  const store = getStore();
  const workspace = store.saveInstall({
    slackTeamId: 'T1',
    name: 'Test Workspace',
    botTokenEncrypted: 'token',
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

  it('enableIntegrationCapabilities is idempotent', async () => {
    const { store, workspace } = await setup();
    const { enableIntegrationCapabilities } = await import('#lib/server/integrations/capabilities');
    const { INTEGRATIONS } = await import('#lib/server/integrations/registry');
    const notion = INTEGRATIONS.find((i) => i.provider === 'notion')!;

    enableIntegrationCapabilities(workspace.id, notion);
    enableIntegrationCapabilities(workspace.id, notion);

    const memory = store.getOrCreateWorkspaceMemory(workspace.id);
    const expectedTools = new Set(notion.tools);
    expect(memory.enabledOptionalTools.filter((t) => expectedTools.has(t))).toEqual(notion.tools);
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

  it('reconcileIntegrationCapabilitiesForWorkspace enables tools when an env credential is set', async () => {
    const { store, workspace } = await setup({ notionApiKey: 'secret_test' });
    const { reconcileIntegrationCapabilitiesForWorkspace } = await import(
      '#lib/server/integrations/capabilities'
    );

    reconcileIntegrationCapabilitiesForWorkspace(workspace.id);

    const memory = store.getOrCreateWorkspaceMemory(workspace.id);
    expect(memory.enabledOptionalTools).toEqual(
      expect.arrayContaining(['notion.search', 'notion.read_page'])
    );
    expect(memory.enabledContextSources).toEqual(
      expect.arrayContaining(['notion.thread_search'])
    );
  });

  it('reconcileIntegrationCapabilitiesForWorkspace leaves memory untouched when no credential exists', async () => {
    const { store, workspace } = await setup();
    const { reconcileIntegrationCapabilitiesForWorkspace } = await import(
      '#lib/server/integrations/capabilities'
    );

    reconcileIntegrationCapabilitiesForWorkspace(workspace.id);

    const memory = store.getOrCreateWorkspaceMemory(workspace.id);
    expect(memory.enabledOptionalTools).not.toContain('notion.search');
    expect(memory.enabledContextSources).not.toContain('notion.thread_search');
  });
});
