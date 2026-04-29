import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

async function loadTool() {
  vi.resetModules();
  const module = await import('../../src/lib/server/tools/file-ops');
  return module.createFileReadTool();
}

describe('fs.read tool', () => {
  afterEach(() => {
    delete process.env.MURPH_FILE_READ_ALLOWED_ROOTS;
  });

  it('reads files inside allowed roots', async () => {
    const root = mkdtempSync(join(tmpdir(), 'murph-file-tool-'));
    const file = join(root, 'notes.txt');
    writeFileSync(file, 'launch checklist');
    process.env.MURPH_FILE_READ_ALLOWED_ROOTS = root;

    const tool = await loadTool();
    const result = await tool.execute({ path: file }, { workspace: { id: 'T1', slackTeamId: 'T1', name: 'Test' } });

    expect(result.text).toBe('launch checklist');
    expect(result.path).toBe(file);
  });

  it('blocks reads outside allowed roots', async () => {
    const root = mkdtempSync(join(tmpdir(), 'murph-file-tool-'));
    const outside = join(tmpdir(), 'murph-outside.txt');
    writeFileSync(outside, 'secret');
    process.env.MURPH_FILE_READ_ALLOWED_ROOTS = root;

    const tool = await loadTool();

    await expect(tool.execute({ path: outside }, { workspace: { id: 'T1', slackTeamId: 'T1', name: 'Test' } })).rejects.toThrow(
      /outside allowed read roots/
    );
  });

  it('blocks sensitive paths regardless of roots', async () => {
    process.env.MURPH_FILE_READ_ALLOWED_ROOTS = '/';
    const tool = await loadTool();

    await expect(tool.execute({ path: '~/.ssh/id_rsa' }, { workspace: { id: 'T1', slackTeamId: 'T1', name: 'Test' } })).rejects.toThrow(
      /blocked by Murph safety policy/
    );
  });
});
