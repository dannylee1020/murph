import { describe, expect, it, vi } from 'vitest';

async function loadTool() {
  vi.resetModules();
  const module = await import('../../src/lib/server/tools/shell');
  return module.createShellExecTool();
}

describe('shell.exec tool', () => {
  it('runs allowed read-only commands', async () => {
    const tool = await loadTool();
    const result = await tool.execute({ command: 'pwd' }, { workspace: { id: 'T1', slackTeamId: 'T1', name: 'Test' } });

    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim().length).toBeGreaterThan(0);
  });

  it('rejects shell composition tokens', async () => {
    const tool = await loadTool();

    await expect(tool.execute({ command: 'pwd && ls' }, { workspace: { id: 'T1', slackTeamId: 'T1', name: 'Test' } })).rejects.toThrow(
      /composition tokens/
    );
  });

  it('rejects disallowed git subcommands', async () => {
    const tool = await loadTool();

    await expect(tool.execute({ command: 'git reset --hard' }, { workspace: { id: 'T1', slackTeamId: 'T1', name: 'Test' } })).rejects.toThrow(
      /Subcommand is not allowed/
    );
  });
});
