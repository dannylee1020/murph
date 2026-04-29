import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('local file retrieval', () => {
  let root: string;

  beforeEach(() => {
    vi.resetModules();
    root = mkdtempSync(join(tmpdir(), 'murph-localfs-'));
    mkdirSync(join(root, 'docs'));
    writeFileSync(join(root, 'docs', 'launch.md'), '# Launch readiness\nHold until wallet failures drop.');
    writeFileSync(join(root, 'README.md'), 'general project notes');
    process.env.MURPH_FILE_READ_ALLOWED_ROOTS = root;
  });

  afterEach(() => {
    delete process.env.MURPH_FILE_READ_ALLOWED_ROOTS;
  });

  it('returns top matching local files as structured matches', async () => {
    const { searchLocalFiles, toArtifact } = await import('#lib/server/context-sources/local-fs');
    const results = await searchLocalFiles('launch wallet readiness', 3);

    expect(results[0]).toEqual(
      expect.objectContaining({
        title: 'launch.md'
      })
    );
    expect(toArtifact(results[0])).toEqual(
      expect.objectContaining({
        source: 'localfs',
        type: 'file'
      })
    );
  });
});
