import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { stringify } from 'yaml';
import {
  SOURCE_INDEX_SCHEMA_VERSION,
  SourceIndexCatalog,
  sourceIndexSafeSegment,
  writeSourceIndexResource
} from '../../app/server/source-index/catalog';

const createChatCompletionMock = vi.hoisted(() => vi.fn());

vi.mock('openai', () => ({
  default: vi.fn(function OpenAIMock() {
    return {
      chat: {
        completions: {
          create: createChatCompletionMock
        }
      }
    };
  })
}));

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
      summaryStatus: 'missing',
      tags: ['checkout', 'launch']
    },
    routingNotes: 'Use this issue for checkout launch status questions.',
    ...overrides
  };
}

function legacyResourcePath(input: Parameters<typeof writeSourceIndexResource>[0]): string {
  return join(
    process.env.MURPH_MEMORY_PATH!,
    'source-index',
    'workspaces',
    sourceIndexSafeSegment(input.metadata.workspaceId),
    sourceIndexSafeSegment(input.metadata.provider),
    sourceIndexSafeSegment(input.metadata.resourceType),
    `${sourceIndexSafeSegment(input.metadata.externalId)}.md`
  );
}

function renderTestResource(input: Parameters<typeof writeSourceIndexResource>[0]): string {
  return [
    `---\n${stringify(input.metadata, { lineWidth: 120 }).trimEnd()}\n---`,
    '',
    '## Routing Notes',
    '',
    input.routingNotes ?? '',
    '',
    input.contentSummary ? ['## Content Summary', '', input.contentSummary, ''].join('\n') : '',
    input.contentPreview ? ['## Content Preview', '', input.contentPreview, ''].join('\n') : ''
  ].filter(Boolean).join('\n').trimEnd() + '\n';
}

function writeLegacyResource(input: Parameters<typeof writeSourceIndexResource>[0]): string {
  const filePath = legacyResourcePath(input);
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, renderTestResource(input));
  return filePath;
}

describe('SourceIndexCatalog', () => {
  beforeEach(() => {
    vi.resetModules();
    createChatCompletionMock.mockReset();
    process.env.MURPH_MEMORY_PATH = tempMemoryPath();
    delete process.env.OPENAI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.MURPH_AGENT_PROVIDER;
    delete process.env.MURPH_AGENT_MODEL;
    delete process.env.MURPH_SOURCE_INDEX_SUMMARIES_IN_TEST;
  });

  it('writes versioned resource markdown using safe source-index paths', async () => {
    const result = await writeSourceIndexResource(resource({
      metadata: {
        ...resource().metadata,
        workspaceId: '../workspace',
        externalId: '../../secret'
      }
    }));

    expect(result.relativePath).toMatch(/^providers\//);
    expect(result.relativePath).not.toContain('..');
    expect(result.relativePath).toContain('providers/github/workspaces/workspace/issue-');
    expect(existsSync(result.path)).toBe(true);
    const text = readFileSync(result.path, 'utf8');
    expect(text).toContain('schemaVersion: 1');
    expect(text).toContain('summaryStatus: missing');
    expect(text).toContain('## Routing Notes');
    expect(text).not.toContain('## Content Summary');
    expect(text).not.toContain('## Content Preview');
    expect(text).not.toContain('## Summary');
    expect(text).not.toContain('## Excerpt');
  });

  it('loads bounded active hints for the requested workspace only', async () => {
    await writeSourceIndexResource(resource({
      contentSummary: 'Checkout launch is blocked on payment callback verification.',
      contentPreview: 'Payment callback verification remains open.'
    }));
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

    const hints = await catalog.hintsFor({
      workspaceId: 'workspace-1',
      query: 'what is blocking checkout launch?',
      maxChars: 240
    });

    expect(hints).toHaveLength(1);
    expect(hints[0]).toEqual(expect.objectContaining({
      provider: 'github',
      resourceType: 'issue',
      id: 'h1',
      title: 'Checkout launch blocker',
      externalId: 'murph/murph#42',
      readTool: 'github.read_issue'
    }));
    expect(hints[0].text).toContain('Summary: Checkout launch is blocked');
    expect(hints[0].text.length).toBeLessThanOrEqual(240);
  });

  it('preserves generated summaries when the source has not changed', async () => {
    const first = await writeSourceIndexResource(resource({
      metadata: {
        ...resource().metadata,
        summaryStatus: 'generated',
        summaryUpdatedAt: '2026-06-02T21:00:00.000Z'
      },
      contentSummary: 'Checkout launch is blocked by callback verification.',
      contentPreview: 'Payment callback verification remains open.'
    }));

    await writeSourceIndexResource(resource({
      contentPreview: 'Payment callback verification remains open with newer routing text.'
    }));

    const text = readFileSync(first.path, 'utf8');
    expect(text).toContain('summaryStatus: generated');
    expect(text).toContain('summaryUpdatedAt: 2026-06-02T21:00:00.000Z');
    expect(text).toContain('## Content Summary');
    expect(text).toContain('Checkout launch is blocked by callback verification.');
  });

  it('loads legacy workspace-first source-index resources', async () => {
    writeLegacyResource(resource({
      contentSummary: 'Legacy checkout launch summary.',
      contentPreview: 'Legacy checkout launch preview.'
    }));

    const catalog = new SourceIndexCatalog();
    await catalog.reload();

    const hints = await catalog.hintsFor({
      workspaceId: 'workspace-1',
      query: 'checkout launch'
    });

    expect(hints).toHaveLength(1);
    expect(hints[0]).toEqual(expect.objectContaining({
      provider: 'github',
      resourceType: 'issue',
      title: 'Checkout launch blocker',
      externalId: 'murph/murph#42'
    }));
  });

  it('dedupes legacy and provider-first resources and prefers provider-first content', async () => {
    writeLegacyResource(resource({
      contentSummary: 'Legacy checkout launch summary.'
    }));
    await writeSourceIndexResource(resource({
      contentSummary: 'Provider-first checkout launch summary.'
    }));

    const catalog = new SourceIndexCatalog();
    await catalog.reload();

    const hints = await catalog.hintsFor({
      workspaceId: 'workspace-1',
      query: 'checkout launch'
    });

    expect(hints).toHaveLength(1);
    expect(hints[0].text).toContain('Provider-first checkout launch summary.');
    expect(hints[0].text).not.toContain('Legacy checkout launch summary.');
  });

  it('carries legacy generated summaries into provider-first writes when the source has not changed', async () => {
    writeLegacyResource(resource({
      metadata: {
        ...resource().metadata,
        summaryStatus: 'generated',
        summaryUpdatedAt: '2026-06-02T21:00:00.000Z'
      },
      contentSummary: 'Legacy summary should carry forward.',
      contentPreview: 'Legacy preview.'
    }));

    const result = await writeSourceIndexResource(resource({
      contentPreview: 'Updated preview with unchanged source timestamp.'
    }));

    expect(result.relativePath).toMatch(/^providers\//);
    const text = readFileSync(result.path, 'utf8');
    expect(text).toContain('summaryStatus: generated');
    expect(text).toContain('summaryUpdatedAt: 2026-06-02T21:00:00.000Z');
    expect(text).toContain('Legacy summary should carry forward.');
  });

  it('skips model summaries when no model credentials are configured', async () => {
    const result = await writeSourceIndexResource(resource({
      contentPreview: 'Payment callback verification remains open.'
    }));
    const { summarizeChangedSourceIndexResources } = await import('../../app/server/source-index/summarizer');

    await expect(summarizeChangedSourceIndexResources({
      workspaceId: 'workspace-1',
      changedPaths: [result.relativePath]
    })).resolves.toEqual({ generated: 0, skipped: 1, failed: 0 });
  });

  it('uses max_completion_tokens for OpenAI source-index summaries', async () => {
    process.env.OPENAI_API_KEY = 'sk-test';
    process.env.MURPH_AGENT_PROVIDER = 'openai';
    process.env.MURPH_AGENT_MODEL = 'gpt-5.5';
    process.env.MURPH_SOURCE_INDEX_SUMMARIES_IN_TEST = 'true';
    createChatCompletionMock.mockResolvedValueOnce({
      choices: [{ message: { content: 'Checkout launch is blocked by payment callback verification.' } }]
    });
    const result = await writeSourceIndexResource(resource({
      contentPreview: 'Payment callback verification remains open.'
    }));
    const { summarizeChangedSourceIndexResources } = await import('../../app/server/source-index/summarizer');

    await expect(summarizeChangedSourceIndexResources({
      workspaceId: 'workspace-1',
      changedPaths: [result.relativePath]
    })).resolves.toEqual({ generated: 1, skipped: 0, failed: 0 });

    expect(createChatCompletionMock).toHaveBeenCalledWith(expect.objectContaining({
      model: 'gpt-5.5',
      max_completion_tokens: 180
    }));
    expect(createChatCompletionMock.mock.calls[0]?.[0]).not.toHaveProperty('max_tokens');
  });

  it('skips unsupported frontmatter and ignores temp files', async () => {
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
    await expect(catalog.hintsFor({ workspaceId: 'workspace-1', query: 'checkout' })).resolves.toHaveLength(1);

    writeFileSync(result.path, readFileSync(result.path, 'utf8').replace('schemaVersion: 1', 'schemaVersion: 99'));
    await catalog.reload();
    await expect(catalog.hintsFor({ workspaceId: 'workspace-1', query: 'checkout' })).resolves.toHaveLength(0);
  });
});
