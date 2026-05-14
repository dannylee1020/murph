import { access, readdir, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { PLUGINS_ROOT } from '#lib/config';
import { registerAdapter, unregisterAdaptersBySource } from '#lib/server/integrations/adapter-registry';
import type { IntegrationAdapter } from '#lib/server/integrations/adapter';
import { parseSkillFile } from '#lib/server/skills/loader';
import type { SkillManifest } from '#lib/types';
import { clearScopedPluginSkills, registerScopedPluginSkill } from './skill-registry.js';

type ScopedPluginStatus = 'loaded' | 'failed' | 'skipped';

interface ScopedPluginManifest {
  id: string;
  name: string;
  description: string;
  version?: string;
  capabilities?: {
    skills?: string[];
    adapters?: string[];
  };
}

export interface ScopedPluginLoadStatus {
  id: string;
  name?: string;
  version?: string;
  root: string;
  status: ScopedPluginStatus;
  error?: string;
  capabilities: {
    skills: string[];
    adapters: string[];
  };
}

let loaded = false;
let importVersion = 0;
let statuses: ScopedPluginLoadStatus[] = [];

function murphHome(): string {
  return process.env.MURPH_HOME || path.join(homedir(), '.murph');
}

export function getScopedPluginRoots(): string[] {
  return [
    path.join(murphHome(), PLUGINS_ROOT),
    path.resolve(process.cwd(), PLUGINS_ROOT)
  ];
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
  const adapters = asStringArray(capabilities.adapters);
  if (skills.length + adapters.length === 0) {
    throw new Error('plugin.json must declare at least one skill or adapter');
  }

  return {
    id,
    name,
    description,
    version: typeof parsed.version === 'string' ? parsed.version : undefined,
    capabilities: { skills, adapters }
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

function moduleAdapter(module: Record<string, unknown>): IntegrationAdapter | undefined {
  const candidate = module.default ?? module.adapter;
  if (!candidate || typeof candidate !== 'object') {
    return undefined;
  }
  return candidate as IntegrationAdapter;
}

function validatePluginAdapter(adapter: IntegrationAdapter, manifest: ScopedPluginManifest): void {
  if (!adapter.id || !/^[a-z0-9][a-z0-9._-]*$/i.test(adapter.id)) {
    throw new Error(`Invalid integration adapter id: ${adapter.id || '<empty>'}`);
  }

  for (const tool of adapter.tools ?? []) {
    if (tool.sideEffectClass !== 'read') {
      throw new Error(`Plugin adapter ${adapter.id} tool ${tool.name} must be read-only`);
    }
  }

  const rawAdapter = adapter as unknown as Record<string, unknown>;
  if (rawAdapter.channelAdapter || rawAdapter.provider) {
    throw new Error(`Plugin ${manifest.id} can only contribute skills and integration adapters`);
  }
}

async function loadAdapter(filePath: string, manifest: ScopedPluginManifest): Promise<IntegrationAdapter> {
  const moduleUrl = pathToFileURL(filePath);
  moduleUrl.searchParams.set('v', String(importVersion));
  const module = await import(moduleUrl.href);
  const adapter = moduleAdapter(module as Record<string, unknown>);
  if (!adapter) {
    throw new Error(`Adapter ${path.relative(process.cwd(), filePath)} must export default or named adapter`);
  }
  validatePluginAdapter(adapter, manifest);
  return adapter;
}

async function loadPluginPackage(root: string, opts: { register: boolean }): Promise<ScopedPluginLoadStatus> {
  const rawManifest = await readFile(manifestPath(root), 'utf8');
  const manifest = parseManifest(rawManifest);
  const skills: SkillManifest[] = [];
  const adapters: Array<{ adapter: IntegrationAdapter; adapterPath: string }> = [];
  const skillNames: string[] = [];
  const adapterIds: string[] = [];

  for (const relativeSkillPath of manifest.capabilities?.skills ?? []) {
    const skillPath = resolveUnder(root, relativeSkillPath);
    const skill = await parseSkillFile(skillPath);
    if (!skill) {
      throw new Error(`Skill ${relativeSkillPath} is missing frontmatter`);
    }
    skills.push(skill);
    skillNames.push(skill.name);
  }

  for (const relativeAdapterPath of manifest.capabilities?.adapters ?? []) {
    const adapterPath = resolveUnder(root, relativeAdapterPath);
    const adapter = await loadAdapter(adapterPath, manifest);
    adapters.push({ adapter, adapterPath });
    adapterIds.push(adapter.id);
  }

  if (opts.register) {
    for (const skill of skills) {
      registerScopedPluginSkill(skill);
    }
    for (const { adapter, adapterPath } of adapters) {
      registerAdapter(adapter, { source: 'plugin', filePath: adapterPath });
    }
  }

  return {
    id: manifest.id,
    name: manifest.name,
    version: manifest.version,
    root,
    status: 'loaded',
    capabilities: {
      skills: skillNames,
      adapters: adapterIds
    }
  };
}

async function discoverPluginPackages(): Promise<string[]> {
  const packages: string[] = [];

  for (const root of getScopedPluginRoots()) {
    let entries;
    try {
      entries = await readdir(root, { withFileTypes: true });
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT') {
        packages.push(root);
      }
      continue;
    }

    for (const entry of entries) {
      if (entry.isDirectory()) {
        packages.push(path.join(root, entry.name));
      }
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

  for (const root of await discoverPluginPackages()) {
    try {
      await access(manifestPath(root));
      nextStatuses.push(await loadPluginPackage(root, { register: true }));
    } catch (error) {
      nextStatuses.push({
        id: path.basename(root),
        root,
        status: 'failed',
        error: error instanceof Error ? error.message : 'failed to load plugin',
        capabilities: {
          skills: [],
          adapters: []
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
  clearScopedPluginSkills();
  loaded = false;
  statuses = [];
  return loadScopedPlugins();
}

export function listScopedPluginStatuses(): ScopedPluginLoadStatus[] {
  return statuses;
}
