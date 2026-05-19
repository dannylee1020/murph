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
      includeAdapter: true,
      includeSkill: false,
      searchProfile: 'work_item',
      searchToolName: 'linear_test.search_issues'
    });
    const adapter = readFileSync(join(result.root, 'adapters', 'linear_test.mjs'), 'utf8');

    expect(adapter).toContain("name: 'linear_test.search_issues'");
    expect(adapter).toContain('retrievalEligible: true');
    expect(adapter).toContain("retrieval: { profile: 'work_item' }");
    expect(adapter).toContain("required: ['query']");
    expect(adapter).toContain('Keep the normalized { query, limit } contract.');
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
    expect(channel).toContain('connector:');
    expect(channel).toContain('ingress:');
  });
});
