import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';

async function loadAgentCli(home: string, appDir?: string) {
  vi.resetModules();
  process.env.MURPH_HOME = home;
  if (appDir) {
    process.env.MURPH_APP_DIR = appDir;
  } else {
    delete process.env.MURPH_APP_DIR;
  }
  const url = pathToFileURL(join(process.cwd(), 'bin/agent-cli.mjs'));
  url.searchParams.set('v', `${Date.now()}-${Math.random()}`);
  return await import(url.href) as {
    DEFAULT_TOOL_NAMES: string[];
    buildPiArgs(prompt: string, options: Record<string, unknown>, passthrough: string[]): string[];
    scaffoldPlugin(params: Record<string, unknown>): { root: string };
    searchMurphArchitecture(query: string, limit?: number): { results: Array<{ path: string; excerpt: string }> };
    searchMurphDocs(query: string, limit?: number): { results: Array<{ path: string; excerpt: string }> };
    syncBuiltinAgentSkills(): { target: string; synced: string[] };
  };
}

describe('murph agent CLI plugin scaffold', () => {
  beforeEach(() => {
    delete process.env.MURPH_HOME;
    delete process.env.MURPH_APP_DIR;
    delete process.env.OPENAI_API_KEY;
  });

  it('scaffolds searchable connectors with retrieval metadata', async () => {
    const home = mkdtempSync(join(tmpdir(), 'murph-agent-cli-'));
    mkdirSync(join(home, 'plugins'), { recursive: true });
    const { scaffoldPlugin } = await loadAgentCli(home);

    const result = scaffoldPlugin({
      id: 'linear_test',
      name: 'Linear Test',
      includeIntegration: true,
      includeSkill: false,
      searchProfile: 'work_item',
      searchToolName: 'linear_test.search_issues'
    });
    const integration = readFileSync(join(result.root, 'integrations', 'linear_test.mjs'), 'utf8');
    const manifest = readFileSync(join(result.root, 'plugin.json'), 'utf8');

    expect(manifest).toContain('"integrations": [');
    expect(integration).toContain("name: 'linear_test.search_issues'");
    expect(integration).toContain('retrievalEligible: true');
    expect(integration).toContain("retrieval: { profile: 'work_item' }");
    expect(integration).toContain("required: ['query']");
    expect(integration).toContain('Keep the normalized { query, limit } contract.');
  });

  it('scaffolds channel plugins under the channels category', async () => {
    const home = mkdtempSync(join(tmpdir(), 'murph-agent-cli-channel-'));
    mkdirSync(join(home, 'plugins'), { recursive: true });
    const { scaffoldPlugin } = await loadAgentCli(home);

    const result = scaffoldPlugin({
      id: 'teams_test',
      name: 'Teams Test',
      category: 'channels'
    });
    const manifest = readFileSync(join(result.root, 'plugin.json'), 'utf8');
    const channel = readFileSync(join(result.root, 'channel.mjs'), 'utf8');

    expect(result.root).toContain(join('plugins', 'channels', 'teams_test'));
    expect(manifest).toContain('"channels": [');
    expect(channel).toContain("id: 'teams_test'");
    expect(channel).toContain('runtime:');
    expect(channel).toContain('setup:');
    expect(channel).toContain('ingress:');
  });

  it('does not advertise no-server mode', () => {
    const output = execFileSync('node', ['bin/agent-cli.mjs', '--help'], {
      cwd: process.cwd(),
      encoding: 'utf8'
    });

    expect(output).not.toContain('--no-server');
    expect(output).toContain('--source-edits');
  });

  it('rejects no-server mode with a clear message', () => {
    let output = '';
    try {
      execFileSync('node', ['bin/agent-cli.mjs', '--no-server'], {
        cwd: process.cwd(),
        encoding: 'utf8',
        stdio: 'pipe'
      });
    } catch (error) {
      const failure = error as { stdout?: string; stderr?: string; status?: number };
      output = `${failure.stdout ?? ''}${failure.stderr ?? ''}`;
      expect(failure.status).toBe(1);
    }

    expect(output).toContain('--no-server is no longer supported');
  });

  it('loads built-in Murph Agent skills through Pi skill paths', async () => {
    const home = mkdtempSync(join(tmpdir(), 'murph-agent-cli-skills-'));
    const { buildPiArgs, syncBuiltinAgentSkills } = await loadAgentCli(home);
    process.env.OPENAI_API_KEY = 'test-key';
    syncBuiltinAgentSkills();

    const args = buildPiArgs('', {}, []);
    const skillIndex = args.indexOf('--skill');

    expect(skillIndex).toBeGreaterThan(-1);
    expect(args[skillIndex + 1]).toBe(join(home, 'pi-agent', 'skills'));
    expect(readFileSync(join(home, 'pi-agent', 'skills', 'plugin', 'SKILL.md'), 'utf8')).toContain('name: plugin');
  });

  it('preserves unrelated user skills during built-in skill sync', async () => {
    const home = mkdtempSync(join(tmpdir(), 'murph-agent-cli-user-skill-'));
    const userSkill = join(home, 'pi-agent', 'skills', 'custom', 'SKILL.md');
    mkdirSync(join(home, 'pi-agent', 'skills', 'custom'), { recursive: true });
    writeFileSync(userSkill, '---\nname: custom\ndescription: Custom skill.\n---\n\nKeep me.\n');
    const { syncBuiltinAgentSkills } = await loadAgentCli(home);

    const result = syncBuiltinAgentSkills();

    expect(result.synced).toContain('plugin');
    expect(readFileSync(userSkill, 'utf8')).toContain('Keep me.');
  });

  it('enables Murph docs and architecture search tools by default', async () => {
    const home = mkdtempSync(join(tmpdir(), 'murph-agent-cli-tools-'));
    const { DEFAULT_TOOL_NAMES } = await loadAgentCli(home);

    expect(DEFAULT_TOOL_NAMES).toContain('murph_docs_search');
    expect(DEFAULT_TOOL_NAMES).toContain('murph_architecture_search');
  });

  it('searches Murph docs and built-in skills with path metadata', async () => {
    const home = mkdtempSync(join(tmpdir(), 'murph-agent-cli-docs-'));
    const { searchMurphDocs, syncBuiltinAgentSkills } = await loadAgentCli(home);
    syncBuiltinAgentSkills();

    const result = searchMurphDocs('murph_plugin_create_draft', 5);

    expect(result.results.some((entry) => entry.path.includes('~/.murph/pi-agent/skills/'))).toBe(true);
    expect(result.results[0]).toHaveProperty('path');
    expect(result.results[0]).toHaveProperty('excerpt');
  });

  it('searches live source for architecture knowledge', async () => {
    const home = mkdtempSync(join(tmpdir(), 'murph-agent-cli-arch-'));
    const { searchMurphArchitecture } = await loadAgentCli(home);

    const result = searchMurphArchitecture('createMurphTools defineTool', 5);

    expect(result.results.some((entry) => entry.path === 'bin/agent-cli.mjs')).toBe(true);
  });

  it('handles pruned docs when searching live source', async () => {
    const home = mkdtempSync(join(tmpdir(), 'murph-agent-cli-pruned-home-'));
    const app = mkdtempSync(join(tmpdir(), 'murph-agent-cli-pruned-app-'));
    mkdirSync(join(app, 'bin'), { recursive: true });
    writeFileSync(join(app, 'README.md'), '# Murph\n\nLocal first agent.\n');
    writeFileSync(
      join(app, 'bin', 'agent-cli.mjs'),
      'function createMurphTools() { return []; }\n'
    );
    const { searchMurphArchitecture } = await loadAgentCli(home, app);

    const result = searchMurphArchitecture('createMurphTools', 5);

    expect(result.results).toHaveLength(1);
    expect(result.results[0].path).toBe('bin/agent-cli.mjs');
  });
});
