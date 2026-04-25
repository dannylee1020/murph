import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { PLUGINS_ROOT } from '#lib/config';
import type {
  ChannelAdapter,
  ContextSource,
  ModelProvider,
  ProviderName,
  RuntimePlugin,
  RuntimeCapabilityStatus,
  SkillManifest
} from '#lib/types';
import { getChannelRegistry } from '#lib/server/capabilities/channel-registry';
import { getContextSourceRegistry } from '#lib/server/capabilities/context-source-registry';
import { getToolRegistry } from '#lib/server/capabilities/tool-registry';

const providerFactories = new Map<ProviderName, () => ModelProvider>();
const registeredSkills = new Map<string, SkillManifest>();
const loadedPlugins = new Map<string, RuntimePlugin['manifest']>();
const pluginStatuses = new Map<string, RuntimeCapabilityStatus>();

class PluginApi {
  channels: string[] = [];
  tools: string[] = [];
  contextSources: string[] = [];
  skills: string[] = [];
  providers: string[] = [];

  registerChannelAdapter(adapter: ChannelAdapter): void {
    getChannelRegistry().register(adapter);
    this.channels.push(adapter.id);
  }

  registerContextSource(source: ContextSource, opts?: { optional?: boolean }): void {
    getContextSourceRegistry().register(source, { optional: opts?.optional, source: 'plugin' });
    this.contextSources.push(source.name);
  }

  registerTool(tool: any, opts?: { optional?: boolean }): void {
    getToolRegistry().register(tool, { optional: opts?.optional, source: 'plugin' });
    this.tools.push(tool.name);
  }

  registerSkill(skill: SkillManifest): void {
    registeredSkills.set(skill.name, skill);
    this.skills.push(skill.name);
  }

  registerProvider(name: ProviderName, factory: () => ModelProvider): void {
    providerFactories.set(name, factory);
    this.providers.push(name);
  }
}

export async function loadRuntimePlugins(root = PLUGINS_ROOT): Promise<void> {
  try {
    const entries = await readdir(root, { withFileTypes: true });
    const files = entries
      .filter((entry) => entry.isFile() && (entry.name.endsWith('.js') || entry.name.endsWith('.mjs')))
      .map((entry) => path.join(root, entry.name));

    for (const file of files) {
      const mod = await import(pathToFileURL(path.resolve(file)).href);
      const plugin = (mod.default ?? mod.plugin) as RuntimePlugin | undefined;

      if (!plugin || !plugin.manifest || typeof plugin.register !== 'function') {
        continue;
      }

      if (loadedPlugins.has(plugin.manifest.id)) {
        continue;
      }

      const api = new PluginApi();
      await plugin.register(api);
      loadedPlugins.set(plugin.manifest.id, plugin.manifest);
      pluginStatuses.set(plugin.manifest.id, {
        id: plugin.manifest.id,
        kind: 'plugin',
        name: plugin.manifest.name,
        status: 'loaded',
        capabilities: {
          channels: api.channels,
          tools: api.tools,
          contextSources: api.contextSources,
          skills: api.skills,
          providers: api.providers
        }
      });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Plugin loading failed';
    pluginStatuses.set('runtime-plugin-loader', {
      id: 'runtime-plugin-loader',
      kind: 'plugin',
      name: 'Runtime plugin loader',
      status: message.includes('ENOENT') ? 'disabled' : 'failed',
      error: message.includes('ENOENT') ? undefined : message,
      capabilities: {
        channels: [],
        tools: [],
        contextSources: [],
        skills: [],
        providers: []
      }
    });
    return;
  }
}

export function listRegisteredPluginManifests() {
  return [...loadedPlugins.values()];
}

export function listRegisteredPluginSkills(): SkillManifest[] {
  return [...registeredSkills.values()];
}

export function getRegisteredProviderFactory(name: ProviderName): (() => ModelProvider) | undefined {
  return providerFactories.get(name);
}

export function listPluginStatuses(): RuntimeCapabilityStatus[] {
  return [...pluginStatuses.values()];
}
