import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  SOURCE_INDEX_SCHEMA_VERSION,
  SourceIndexCatalog,
  sourceIndexSafeSegment,
  writeSourceIndexResource
} from '../../shared/server/source-index/catalog';

function tempMemoryPath(): string {
  return join(mkdtempSync(join(tmpdir(), 'murph-source-index-')), 'memory');
}

function resource(overrides: Partial<Parameters<typeof writeSourceIndexResource>[0]> = {}): Parameters<typeof writeSourceIndexResource>[0] {
  return {
    metadata: {
      schemaVersion: SOURCE_INDEX_SCHEMA_VERSION,
      provider: 'github',
      workspaceId: 'workspace-1',
      resourceType: 'issue',
      externalId: 'murph/murph#42',
      title: 'Checkout launch blocker',
      url: 'https://github.test/murph/murph/issues/42',
      indexedAt: '2026-06-02T20:00:00.000Z',
      sourceUpdatedAt: '2026-06-02T19:00:00.000Z',
      scope: 'murph/murph',
      readTool: 'github.read_issue',
      readInput: { repository: 'murph/murph', number: 42 },
      status: 'active',
      tags: ['checkout', 'launch']
    },
    summary: 'Checkout launch is blocked on payment callback verification.',
    routingNotes: 'Use this issue for checkout launch status questions.',
    excerpt: 'Payment callback verification remains open.',
    ...overrides
  };
}

describe('SourceIndexCatalog', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.MURPH_MEMORY_PATH = tempMemoryPath();
  });

  it('writes versioned resource markdown using safe source-index paths', async () => {
    const result = await writeSourceIndexResource(resource({
      metadata: {
        ...resource().metadata,
        workspaceId: '../workspace',
        externalId: '../../secret'
      }
    }));

    expect(result.relativePath).toMatch(/^workspaces\//);
    expect(result.relativePath).not.toContain('..');
    expect(result.relativePath).toContain(`${sourceIndexSafeSegment('../workspace')}/github-`);
    expect(existsSync(result.path)).toBe(true);
    const text = readFileSync(result.path, 'utf8');
    expect(text).toContain('schemaVersion: 1');
    expect(text).toContain('## Routing Notes');
    expect(text).not.toContain('## Summary');
    expect(text).not.toContain('## Excerpt');
  });

  it('loads bounded active hints for the requested workspace only', async () => {
    await writeSourceIndexResource(resource());
    await writeSourceIndexResource(resource({
      metadata: {
        ...resource().metadata,
        workspaceId: 'workspace-2',
        externalId: 'murph/murph#43',
        title: 'Checkout launch mirror'
      }
    }));
    await writeSourceIndexResource(resource({
      metadata: {
        ...resource().metadata,
        externalId: 'murph/murph#44',
        title: 'Checkout stale note',
        status: 'stale'
      }
    }));
    await writeSourceIndexResource(resource({
      metadata: {
        ...resource().metadata,
        externalId: 'murph/murph#45',
        title: 'Checkout deleted note',
        status: 'deleted'
      }
    }));

    const catalog = new SourceIndexCatalog();
    await catalog.reload();

    const hints = catalog.hintsFor({
      workspaceId: 'workspace-1',
      query: 'what is blocking checkout launch?',
      maxChars: 240
    });

    expect(hints).toHaveLength(1);
    expect(hints[0]).toEqual(expect.objectContaining({
      provider: 'github',
      resourceType: 'issue',
      title: 'Checkout launch blocker',
      externalId: 'murph/murph#42',
      readTool: 'github.read_issue'
    }));
    expect(hints[0].text.length).toBeLessThanOrEqual(240);
  });

  it('rejects unsupported frontmatter and ignores temp files', async () => {
    const result = await writeSourceIndexResource(resource());
    writeFileSync(`${result.path}.tmp`, [
      '---',
      'schemaVersion: 99',
      'provider: github',
      'workspaceId: workspace-1',
      'resourceType: issue',
      'externalId: bad',
      'title: Bad',
      'indexedAt: 2026-06-02T20:00:00.000Z',
      'status: active',
      '---',
      '## Routing Notes',
      'bad'
    ].join('\n'));

    const catalog = new SourceIndexCatalog();
    await catalog.reload();
    expect(catalog.hintsFor({ workspaceId: 'workspace-1', query: 'checkout' })).toHaveLength(1);

    writeFileSync(result.path, readFileSync(result.path, 'utf8').replace('schemaVersion: 1', 'schemaVersion: 99'));
    await expect(catalog.reload()).rejects.toThrow(/unsupported schemaVersion/);
  });
});
