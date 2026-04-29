import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('Obsidian retrieval', () => {
  let vault: string;

  beforeEach(() => {
    vi.resetModules();
    vault = mkdtempSync(join(tmpdir(), 'murph-obsidian-'));
    writeFileSync(
      join(vault, 'Fundraising.md'),
      '---\ntags: [fundraising]\n---\n[[Partner Notes]]\nSeed round target and investor follow-ups.'
    );
    process.env.OBSIDIAN_VAULT_PATH = vault;
    process.env.MURPH_FILE_READ_ALLOWED_ROOTS = vault;
  });

  afterEach(() => {
    delete process.env.OBSIDIAN_VAULT_PATH;
    delete process.env.MURPH_FILE_READ_ALLOWED_ROOTS;
  });

  it('searches notes inside the configured vault', async () => {
    const { searchObsidianNotes, toArtifact } = await import('#lib/server/context-sources/obsidian');
    const results = await searchObsidianNotes('investor fundraising follow-ups', 3);

    expect(results[0]).toEqual(
      expect.objectContaining({
        title: 'Fundraising',
        wikilinks: ['Partner Notes']
      })
    );
    expect(toArtifact(results[0])).toEqual(
      expect.objectContaining({
        source: 'obsidian',
        type: 'document'
      })
    );
  });

  it('reads a note by path', async () => {
    const notePath = join(vault, 'Fundraising.md');
    const { readObsidianNote } = await import('#lib/server/context-sources/obsidian');
    const result = await readObsidianNote(notePath);

    expect(result).toEqual(
      expect.objectContaining({
        title: 'Fundraising',
        wikilinks: ['Partner Notes']
      })
    );
    expect(result.text).not.toContain('tags:');
  });
});
