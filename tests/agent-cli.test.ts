import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';

async function loadAgentCli(home: string) {
  vi.resetModules();
  process.env.MURPH_HOME = home;
  const url = pathToFileURL(join(process.cwd(), 'bin/agent-cli.mjs'));
  url.searchParams.set('v', String(Date.now()));
  return await import(url.href) as {
    scaffoldPlugin(params: Record<string, unknown>): { root: string };
  };
}

describe('murph agent CLI plugin scaffold', () => {
  beforeEach(() => {
    delete process.env.MURPH_HOME;
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
});
