import { mkdirSync, writeFileSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const originalCwd = process.cwd();

function tempMurphHome(): string {
  const home = mkdtempSync(join(tmpdir(), 'murph-plugins-'));
  mkdirSync(join(home, 'plugins'), { recursive: true });
  process.env.MURPH_HOME = home;
  return home;
}

function writePlugin(home: string, id: string, options: { toolSideEffect?: string; skillPath?: string } = {}): string {
  const root = join(home, 'plugins', id);
  mkdirSync(join(root, 'skills'), { recursive: true });
  mkdirSync(join(root, 'integrations'), { recursive: true });
  const skillPath = options.skillPath ?? `skills/${id}.md`;

  writeFileSync(join(root, 'plugin.json'), JSON.stringify({
    id,
    name: id,
    description: `${id} plugin`,
    version: '0.1.0',
    capabilities: {
      skills: [skillPath],
      integrations: [`integrations/${id}.mjs`]
    }
  }));
  writeFileSync(join(root, 'skills', `${id}.md`), [
    '---',
    `name: ${id}`,
    'description: Plugin skill',
    'priority: 20',
    '---',
    'Use plugin context.'
  ].join('\n'));
  writeFileSync(join(root, 'integrations', `${id}.mjs`), `
export default {
  id: '${id}',
  name: '${id}',
  description: '${id} integration',
  credential: {
    authType: 'api_key',
    credentialKind: 'api_key',
    envKey: '${id.toUpperCase()}_API_KEY',
    credentialLabel: 'API key'
  },
  tools: [{
    name: '${id}.read',
    description: 'Read ${id}',
    sideEffectClass: '${options.toolSideEffect ?? 'read'}',
    retrievalEligible: true,
    retrieval: { profile: 'work_item' },
    async execute() {
      return { ok: true };
    }
  }],
  contextSources: [{
    name: '${id}.context',
    description: '${id} context',
    optional: true,
    async retrieve() {
      return [];
    }
  }],
  isConfigured() {
    return false;
  }
};
`);
  return root;
}

function writeLegacyAdapterPlugin(home: string, id: string): string {
  const root = join(home, 'plugins', id);
  mkdirSync(join(root, 'adapters'), { recursive: true });
  writeFileSync(join(root, 'plugin.json'), JSON.stringify({
    id,
    name: id,
    description: `${id} plugin`,
    version: '0.1.0',
    capabilities: {
      adapters: [`adapters/${id}.mjs`]
    }
  }));
  writeFileSync(join(root, 'adapters', `${id}.mjs`), 'export default {};');
  return root;
}

function writeChannelPlugin(home: string, id: string): string {
  const root = join(home, 'plugins', 'channels', id);
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, 'plugin.json'), JSON.stringify({
    id,
    name: id,
    description: `${id} channel`,
    version: '0.1.0',
    capabilities: {
      channels: ['channel.mjs']
    }
  }));
  writeFileSync(join(root, 'channel.mjs'), `
export const channel = {
  id: '${id}',
  displayName: '${id}',
  runtime: {
    id: '${id}',
    displayName: '${id}',
    capabilities: ['event_ingress', 'thread_fetch', 'reply_post'],
    normalizeEvent() {
      return null;
    },
    async fetchThread() {
      return [];
    },
    async postReply() {}
  },
  setup: {
    async listMembers() {
      return [{ id: 'U1', displayName: 'User One' }];
    },
    async listChannels() {
      return [{ id: 'C1', displayName: '#general' }];
    }
  }
};
`);
  return root;
}

function writeLegacyChannelPlugin(home: string, id: string): string {
  const root = join(home, 'plugins', 'channels', id);
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, 'plugin.json'), JSON.stringify({
    id,
    name: id,
    description: `${id} channel`,
    version: '0.1.0',
    capabilities: {
      channels: ['channel.mjs']
    }
  }));
  writeFileSync(join(root, 'channel.mjs'), `
export const channel = {
  id: '${id}',
  displayName: '${id}',
  adapter: {
    id: '${id}',
    displayName: '${id}',
    capabilities: ['event_ingress', 'thread_fetch', 'reply_post'],
    normalizeEvent() {
      return null;
    },
    async fetchThread() {
      return [];
    },
    async postReply() {}
  },
  connector: {}
};
`);
  return root;
}

describe('scoped plugin loader', () => {
  beforeEach(() => {
    vi.resetModules();
    process.chdir(originalCwd);
    delete process.env.MURPH_HOME;
  });

  afterEach(() => {
    process.chdir(originalCwd);
  });

  it('loads plugin skills and read-only integration capabilities', async () => {
    const home = tempMurphHome();
    writePlugin(home, 'linear');

    const { loadScopedPlugins } = await import('#shared/server/plugins/loader');
    const { loadSkills } = await import('#shared/server/skills/loader');
    const { getToolRegistry } = await import('#shared/server/capabilities/tool-registry');
    const { getContextSourceRegistry } = await import('#shared/server/capabilities/context-source-registry');

    const statuses = await loadScopedPlugins();

    expect(statuses).toEqual([
      expect.objectContaining({
        id: 'linear',
        status: 'loaded',
        capabilities: {
          channels: [],
          skills: ['linear'],
          integrations: ['linear']
        }
      })
    ]);
    expect((await loadSkills('__missing__')).map((skill) => skill.name)).toContain('linear');
    expect(getToolRegistry().has('linear.read')).toBe(true);
    expect(getToolRegistry().list().find((tool) => tool.name === 'linear.read')?.retrieval).toEqual({
      profile: 'work_item'
    });
    expect(getContextSourceRegistry().has('linear.context')).toBe(true);
  });

  it('rejects integration tools that are not read-only', async () => {
    const home = tempMurphHome();
    writePlugin(home, 'linear', { toolSideEffect: 'external_write' });

    const { loadScopedPlugins } = await import('#shared/server/plugins/loader');
    const { getToolRegistry } = await import('#shared/server/capabilities/tool-registry');
    const { loadSkills } = await import('#shared/server/skills/loader');

    const statuses = await loadScopedPlugins();

    expect(statuses[0]).toEqual(expect.objectContaining({
      id: 'linear',
      status: 'failed',
      error: 'Plugin integration linear tool linear.read must be read-only'
    }));
    expect(getToolRegistry().has('linear.read')).toBe(false);
    expect((await loadSkills('__missing__')).map((skill) => skill.name)).not.toContain('linear');
  });

  it('rejects manifest paths that escape the plugin root', async () => {
    const home = tempMurphHome();
    writePlugin(home, 'linear', { skillPath: '../outside.md' });

    const { loadScopedPlugins } = await import('#shared/server/plugins/loader');

    const statuses = await loadScopedPlugins();

    expect(statuses[0]).toEqual(expect.objectContaining({
      id: 'linear',
      status: 'failed',
      error: 'Plugin path escapes package root: ../outside.md'
    }));
  });

  it('rejects old adapter-only manifests', async () => {
    const home = tempMurphHome();
    writeLegacyAdapterPlugin(home, 'linear');

    const { loadScopedPlugins } = await import('#shared/server/plugins/loader');

    const statuses = await loadScopedPlugins();

    expect(statuses[0]).toEqual(expect.objectContaining({
      id: 'linear',
      status: 'failed',
      error: 'plugin.json must declare at least one skill, integration, or channel'
    }));
  });

  it('loads category-first channel plugins', async () => {
    const home = tempMurphHome();
    writeChannelPlugin(home, 'teams');

    const { loadScopedPlugins } = await import('#shared/server/plugins/loader');
    const { getChannelRegistry } = await import('#shared/server/capabilities/channel-registry');

    const statuses = await loadScopedPlugins();

    expect(statuses).toEqual([
      expect.objectContaining({
        id: 'teams',
        category: 'channels',
        status: 'loaded',
        capabilities: {
          channels: ['teams'],
          skills: [],
          integrations: []
        }
      })
    ]);
    expect(getChannelRegistry().list().find((channel) => channel.id === 'teams')).toEqual(expect.objectContaining({
      id: 'teams',
      source: 'plugin',
      setup: expect.objectContaining({ configurable: true })
    }));
  });

  it('rejects old channel adapter descriptors', async () => {
    const home = tempMurphHome();
    writeLegacyChannelPlugin(home, 'teams');

    const { loadScopedPlugins } = await import('#shared/server/plugins/loader');

    const statuses = await loadScopedPlugins();

    expect(statuses[0]).toEqual(expect.objectContaining({
      id: 'teams',
      status: 'failed',
      error: 'Channel plugin teams runtime id must match channel id'
    }));
  });

  it('loads only the Murph home plugin root by default', async () => {
    const home = tempMurphHome();
    const workspace = mkdtempSync(join(tmpdir(), 'murph-repo-local-plugins-'));
    writePlugin(home, 'global_plugin');
    writePlugin(workspace, 'repo_plugin');
    process.chdir(workspace);

    const { getScopedPluginRoots, loadScopedPlugins } = await import('#shared/server/plugins/loader');

    expect(getScopedPluginRoots()).toEqual([join(home, 'plugins')]);
    expect((await loadScopedPlugins()).map((status) => status.id)).toEqual(['global_plugin']);
  });
});
