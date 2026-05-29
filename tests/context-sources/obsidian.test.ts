import { mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('Obsidian context source', () => {
  let root: string;
  let vault: string;
  let outside: string;

  beforeEach(() => {
    vi.resetModules();
    root = mkdtempSync(join(tmpdir(), 'murph-obsidian-'));
    vault = join(root, 'Vault');
    outside = join(root, 'outside.md');
    mkdirSync(join(vault, 'Projects'), { recursive: true });
    mkdirSync(join(vault, '.obsidian'), { recursive: true });
    writeFileSync(join(vault, 'Projects', 'Launch Plan.md'), [
      '---',
      'tags: [launch]',
      '---',
      '# Launch Plan',
      'Acme rollout readiness depends on [[Customer Notes|customer notes]].',
      ''
    ].join('\n'));
    writeFileSync(join(vault, '.obsidian', 'workspace.md'), 'hidden launch details');
    writeFileSync(outside, 'outside launch detail');
    process.env.OBSIDIAN_VAULT_PATH = vault;
    process.env.MURPH_CONFIG_PATH = join(root, 'config.yaml');
  });

  it('searches Markdown notes inside the configured vault only', async () => {
    const { searchObsidianNotes } = await import('../../shared/server/context-sources/obsidian');

    const results = await searchObsidianNotes('acme rollout readiness', 5);

    expect(results).toHaveLength(1);
    expect(results[0]).toEqual(expect.objectContaining({
      title: 'Launch Plan',
      relativePath: 'Projects/Launch Plan.md',
      wikilinks: ['Customer Notes']
    }));
    expect(results[0].text).toContain('# Launch Plan');
    expect(results[0].text).not.toContain('tags: [launch]');
    expect(results[0].url).toContain('obsidian://open?path=');
  });

  it('reads notes by relative path and refuses paths outside the vault', async () => {
    const { readObsidianNote } = await import('../../shared/server/context-sources/obsidian');

    const note = await readObsidianNote('Projects/Launch Plan');
    expect(note.text).toContain('Acme rollout readiness');

    await expect(readObsidianNote(outside)).rejects.toThrow('inside the configured vault');
    await expect(readObsidianNote('../outside.md')).rejects.toThrow('inside the configured vault');
  });

  it('refuses vault-local symlinks that resolve outside the vault', async () => {
    symlinkSync(outside, join(vault, 'Linked Outside.md'));
    const { readObsidianNote } = await import('../../shared/server/context-sources/obsidian');

    await expect(readObsidianNote('Linked Outside.md')).rejects.toThrow('inside the configured vault');
  });

  it('validates that a vault path exists, is a directory, and is readable', async () => {
    const { validateObsidianVaultPath } = await import('../../shared/server/context-sources/obsidian');

    await expect(validateObsidianVaultPath(vault)).resolves.toEqual({ vaultPath: realpathSync(vault) });
    await expect(validateObsidianVaultPath(outside)).rejects.toThrow('must be a directory');
    await expect(validateObsidianVaultPath(join(root, 'missing'))).rejects.toThrow('does not exist');
  });
});
