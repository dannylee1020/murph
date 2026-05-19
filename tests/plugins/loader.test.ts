import { mkdirSync, writeFileSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

function tempMurphHome(): string {
  const home = mkdtempSync(join(tmpdir(), 'murph-plugins-'));
  mkdirSync(join(home, 'plugins'), { recursive: true });
  process.env.MURPH_HOME = home;
  return home;
}

function writePlugin(home: string, id: string, options: { toolSideEffect?: string; skillPath?: string } = {}): string {
  const root = join(home, 'plugins', id);
  mkdirSync(join(root, 'skills'), { recursive: true });
  mkdirSync(join(root, 'adapters'), { recursive: true });
  const skillPath = options.skillPath ?? `skills/${id}.md`;

  writeFileSync(join(root, 'plugin.json'), JSON.stringify({
    id,
    name: id,
    description: `${id} plugin`,
    version: '0.1.0',
    capabilities: {
      skills: [skillPath],
      adapters: [`adapters/${id}.mjs`]
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
  writeFileSync(join(root, 'adapters', `${id}.mjs`), `
export default {
  id: '${id}',
  name: '${id}',
  description: '${id} adapter',
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
  connector: {
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

describe('scoped plugin loader', () => {
  beforeEach(() => {
    vi.resetModules();
    delete process.env.MURPH_HOME;
  });

  it('loads plugin skills and read-only adapter capabilities', async () => {
    const home = tempMurphHome();
    writePlugin(home, 'linear');

    const { loadScopedPlugins } = await import('#lib/server/plugins/loader');
    const { loadSkills } = await import('#lib/server/skills/loader');
    const { getToolRegistry } = await import('#lib/server/capabilities/tool-registry');
    const { getContextSourceRegistry } = await import('#lib/server/capabilities/context-source-registry');

    const statuses = await loadScopedPlugins();

    expect(statuses).toEqual([
      expect.objectContaining({
        id: 'linear',
        status: 'loaded',
        capabilities: {
          channels: [],
          skills: ['linear'],
          adapters: ['linear']
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

  it('rejects adapter tools that are not read-only', async () => {
    const home = tempMurphHome();
    writePlugin(home, 'linear', { toolSideEffect: 'external_write' });

    const { loadScopedPlugins } = await import('#lib/server/plugins/loader');
    const { getToolRegistry } = await import('#lib/server/capabilities/tool-registry');
    const { loadSkills } = await import('#lib/server/skills/loader');

    const statuses = await loadScopedPlugins();

    expect(statuses[0]).toEqual(expect.objectContaining({
      id: 'linear',
      status: 'failed',
        error: 'Plugin adapter linear tool linear.read must be read-only'
      }));
    expect(getToolRegistry().has('linear.read')).toBe(false);
    expect((await loadSkills('__missing__')).map((skill) => skill.name)).not.toContain('linear');
  });

  it('rejects manifest paths that escape the plugin root', async () => {
    const home = tempMurphHome();
    writePlugin(home, 'linear', { skillPath: '../outside.md' });

    const { loadScopedPlugins } = await import('#lib/server/plugins/loader');

    const statuses = await loadScopedPlugins();

    expect(statuses[0]).toEqual(expect.objectContaining({
      id: 'linear',
      status: 'failed',
      error: 'Plugin path escapes package root: ../outside.md'
    }));
  });

  it('loads category-first channel plugins', async () => {
    const home = tempMurphHome();
    writeChannelPlugin(home, 'teams');

    const { loadScopedPlugins } = await import('#lib/server/plugins/loader');
    const { getChannelRegistry } = await import('#lib/server/capabilities/channel-registry');

    const statuses = await loadScopedPlugins();

    expect(statuses).toEqual([
      expect.objectContaining({
        id: 'teams',
        category: 'channels',
        status: 'loaded',
        capabilities: {
          channels: ['teams'],
          skills: [],
          adapters: []
        }
      })
    ]);
    expect(getChannelRegistry().list().find((channel) => channel.id === 'teams')).toEqual(expect.objectContaining({
      id: 'teams',
      source: 'plugin',
      setup: expect.objectContaining({ configurable: true })
    }));
  });

});
