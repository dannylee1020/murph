import { access, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { registerAdapter, unregisterAdaptersBySource } from '#shared/server/integrations/adapter-registry';
import type { IntegrationAdapter } from '#shared/server/integrations/adapter';
import { getChannelRegistry } from '#shared/server/capabilities/channel-registry';
import { parseSkillFile } from '#shared/server/skills/loader';
import { userPluginRoot } from '#shared/server/setup/paths';
import type { ChannelPlugin, SkillManifest } from '#shared/types';
import { clearScopedPluginSkills, registerScopedPluginSkill } from './skill-registry.js';

type ScopedPluginStatus = 'loaded' | 'failed' | 'skipped';
type ScopedPluginCategory = 'channels' | 'tools' | 'skills' | 'context' | 'bundles' | 'legacy';

const PLUGIN_CATEGORIES = new Set<ScopedPluginCategory>(['channels', 'tools', 'skills', 'context', 'bundles']);

interface ScopedPluginManifest {
  id: string;
  name: string;
  description: string;
  version?: string;
  capabilities?: {
    skills?: string[];
    integrations?: string[];
    channels?: string[];
  };
}

export interface ScopedPluginLoadStatus {
  id: string;
  name?: string;
  version?: string;
  root: string;
  status: ScopedPluginStatus;
  error?: string;
  category?: ScopedPluginCategory;
  capabilities: {
    channels: string[];
    skills: string[];
    integrations: string[];
  };
}

let loaded = false;
let importVersion = 0;
let statuses: ScopedPluginLoadStatus[] = [];

export function getScopedPluginRoots(): string[] {
  return [userPluginRoot()];
}

function manifestPath(root: string): string {
  return path.join(root, 'plugin.json');
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((entry): entry is string => typeof entry === 'string' && entry.trim() !== '');
}

function parseManifest(raw: string): ScopedPluginManifest {
  const parsed = JSON.parse(raw) as unknown;
  if (!isObject(parsed)) {
    throw new Error('plugin.json must contain an object');
  }

  const id = typeof parsed.id === 'string' ? parsed.id.trim() : '';
  if (!id || !/^[a-z0-9][a-z0-9._-]*$/i.test(id)) {
    throw new Error(`Invalid plugin id: ${id || '<empty>'}`);
  }

  const name = typeof parsed.name === 'string' ? parsed.name.trim() : '';
  if (!name) {
    throw new Error('plugin.json requires name');
  }

  const description = typeof parsed.description === 'string' ? parsed.description.trim() : '';
  if (!description) {
    throw new Error('plugin.json requires description');
  }

  const capabilities = isObject(parsed.capabilities) ? parsed.capabilities : {};
  const skills = asStringArray(capabilities.skills);
  const integrations = asStringArray(capabilities.integrations);
  const channels = asStringArray(capabilities.channels);
  if (skills.length + integrations.length + channels.length === 0) {
    throw new Error('plugin.json must declare at least one skill, integration, or channel');
  }

  return {
    id,
    name,
    description,
    version: typeof parsed.version === 'string' ? parsed.version : undefined,
    capabilities: { skills, integrations, channels }
  };
}

function resolveUnder(root: string, relativePath: string): string {
  const rootPath = path.resolve(root);
  const candidate = path.resolve(rootPath, relativePath);
  if (candidate !== rootPath && !candidate.startsWith(`${rootPath}${path.sep}`)) {
    throw new Error(`Plugin path escapes package root: ${relativePath}`);
  }
  return candidate;
}

function moduleIntegration(module: Record<string, unknown>): IntegrationAdapter | undefined {
  const candidate = module.default ?? module.integration;
  if (!candidate || typeof candidate !== 'object') {
    return undefined;
  }
  return candidate as IntegrationAdapter;
}

function moduleChannel(module: Record<string, unknown>): ChannelPlugin | undefined {
  const candidate = module.default ?? module.channel;
  if (!candidate || typeof candidate !== 'object') {
    return undefined;
  }
  return candidate as ChannelPlugin;
}

function validatePluginIntegration(integration: IntegrationAdapter, manifest: ScopedPluginManifest): void {
  if (!integration.id || !/^[a-z0-9][a-z0-9._-]*$/i.test(integration.id)) {
    throw new Error(`Invalid plugin integration id: ${integration.id || '<empty>'}`);
  }

  for (const tool of integration.tools ?? []) {
    if (tool.sideEffectClass !== 'read') {
      throw new Error(`Plugin integration ${integration.id} tool ${tool.name} must be read-only`);
    }
  }

  const rawIntegration = integration as unknown as Record<string, unknown>;
  if (rawIntegration.channelAdapter || rawIntegration.provider) {
    throw new Error(`Plugin ${manifest.id} can only contribute skills and integrations`);
  }
}

async function loadIntegration(filePath: string, manifest: ScopedPluginManifest): Promise<IntegrationAdapter> {
  const moduleUrl = pathToFileURL(filePath);
  moduleUrl.searchParams.set('v', String(importVersion));
  const module = await import(moduleUrl.href);
  const integration = moduleIntegration(module as Record<string, unknown>);
  if (!integration) {
    throw new Error(`Integration ${path.relative(process.cwd(), filePath)} must export default or named integration`);
  }
  validatePluginIntegration(integration, manifest);
  return integration;
}

function validatePluginChannel(channel: ChannelPlugin, manifest: ScopedPluginManifest): void {
  if (!channel.id || !/^[a-z0-9][a-z0-9._-]*$/i.test(channel.id)) {
    throw new Error(`Invalid channel id: ${channel.id || '<empty>'}`);
  }
  if (channel.id !== manifest.id) {
    throw new Error(`Channel plugin ${manifest.id} must export channel id ${manifest.id}`);
  }
  if (!channel.runtime || channel.runtime.id !== channel.id) {
    throw new Error(`Channel plugin ${manifest.id} runtime id must match channel id`);
  }
  if (!Array.isArray(channel.runtime.capabilities)) {
    throw new Error(`Channel plugin ${manifest.id} runtime must declare capabilities`);
  }
  if (typeof channel.runtime.normalizeEvent !== 'function') {
    throw new Error(`Channel plugin ${manifest.id} runtime must implement normalizeEvent`);
  }
  if (typeof channel.runtime.fetchThread !== 'function') {
    throw new Error(`Channel plugin ${manifest.id} runtime must implement fetchThread`);
  }
  if (typeof channel.runtime.postReply !== 'function') {
    throw new Error(`Channel plugin ${manifest.id} runtime must implement postReply`);
  }
}

async function loadChannel(filePath: string, manifest: ScopedPluginManifest): Promise<ChannelPlugin> {
  const moduleUrl = pathToFileURL(filePath);
  moduleUrl.searchParams.set('v', String(importVersion));
  const module = await import(moduleUrl.href);
  const channel = moduleChannel(module as Record<string, unknown>);
  if (!channel) {
    throw new Error(`Channel ${path.relative(process.cwd(), filePath)} must export default or named channel`);
  }
  validatePluginChannel(channel, manifest);
  return channel;
}

async function loadPluginPackage(
  root: string,
  opts: { register: boolean; category?: ScopedPluginCategory }
): Promise<ScopedPluginLoadStatus> {
  const rawManifest = await readFile(manifestPath(root), 'utf8');
  const manifest = parseManifest(rawManifest);
  const skills: SkillManifest[] = [];
  const integrations: Array<{ integration: IntegrationAdapter; integrationPath: string }> = [];
  const channels: Array<{ channel: ChannelPlugin; channelPath: string }> = [];
  const channelIds: string[] = [];
  const skillNames: string[] = [];
  const integrationIds: string[] = [];

  for (const relativeSkillPath of manifest.capabilities?.skills ?? []) {
    const skillPath = resolveUnder(root, relativeSkillPath);
    const skill = await parseSkillFile(skillPath);
    if (!skill) {
      throw new Error(`Skill ${relativeSkillPath} is missing frontmatter`);
    }
    skills.push(skill);
    skillNames.push(skill.name);
  }

  for (const relativeIntegrationPath of manifest.capabilities?.integrations ?? []) {
    const integrationPath = resolveUnder(root, relativeIntegrationPath);
    const integration = await loadIntegration(integrationPath, manifest);
    integrations.push({ integration, integrationPath });
    integrationIds.push(integration.id);
  }

  for (const relativeChannelPath of manifest.capabilities?.channels ?? []) {
    const channelPath = resolveUnder(root, relativeChannelPath);
    const channel = await loadChannel(channelPath, manifest);
    channels.push({ channel, channelPath });
    channelIds.push(channel.id);
  }

  if (opts.register) {
    for (const skill of skills) {
      registerScopedPluginSkill(skill);
    }
    for (const { integration, integrationPath } of integrations) {
      registerAdapter(integration, { source: 'plugin', filePath: integrationPath });
    }
    for (const { channel, channelPath } of channels) {
      getChannelRegistry().registerPlugin(channel, { source: 'plugin', filePath: channelPath });
    }
  }

  return {
    id: manifest.id,
    name: manifest.name,
    version: manifest.version,
    root,
    status: 'loaded',
    category: opts.category,
    capabilities: {
      channels: channelIds,
      skills: skillNames,
      integrations: integrationIds
    }
  };
}

async function discoverPluginPackages(): Promise<Array<{ root: string; category: ScopedPluginCategory }>> {
  const packages: Array<{ root: string; category: ScopedPluginCategory }> = [];

  for (const root of getScopedPluginRoots()) {
    let entries;
    try {
      entries = await readdir(root, { withFileTypes: true });
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT') {
        packages.push({ root, category: 'legacy' });
      }
      continue;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }

      if (PLUGIN_CATEGORIES.has(entry.name as ScopedPluginCategory)) {
        const category = entry.name as ScopedPluginCategory;
        const categoryRoot = path.join(root, entry.name);
        try {
          const categoryEntries = await readdir(categoryRoot, { withFileTypes: true });
          for (const categoryEntry of categoryEntries) {
            if (categoryEntry.isDirectory()) {
              packages.push({ root: path.join(categoryRoot, categoryEntry.name), category });
            }
          }
        } catch {
          packages.push({ root: categoryRoot, category });
        }
        continue;
      }

      packages.push({ root: path.join(root, entry.name), category: 'legacy' });
    }
  }

  return packages;
}

export async function validateScopedPluginPackage(root: string): Promise<ScopedPluginLoadStatus> {
  return loadPluginPackage(root, { register: false });
}

export async function loadScopedPlugins(): Promise<ScopedPluginLoadStatus[]> {
  if (loaded) {
    return statuses;
  }

  const nextStatuses: ScopedPluginLoadStatus[] = [];
  importVersion += 1;

  for (const { root, category } of await discoverPluginPackages()) {
    try {
      await access(manifestPath(root));
      nextStatuses.push(await loadPluginPackage(root, { register: true, category }));
    } catch (error) {
      nextStatuses.push({
        id: path.basename(root),
        root,
        status: 'failed',
        category,
        error: error instanceof Error ? error.message : 'failed to load plugin',
        capabilities: {
          channels: [],
          skills: [],
          integrations: []
        }
      });
    }
  }

  statuses = nextStatuses;
  loaded = true;
  return statuses;
}

export async function reloadScopedPlugins(): Promise<ScopedPluginLoadStatus[]> {
  unregisterAdaptersBySource('plugin');
  getChannelRegistry().unregisterBySource('plugin');
  clearScopedPluginSkills();
  loaded = false;
  statuses = [];
  return loadScopedPlugins();
}

export function listScopedPluginStatuses(): ScopedPluginLoadStatus[] {
  return statuses;
}
