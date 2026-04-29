import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('GranolaService', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.GRANOLA_API_KEY = 'granola-key';
  });

  it('searches notes and ranks matching summaries/transcripts', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('/v1/notes?page_size=10')) {
        return {
          ok: true,
          json: async () => ({
            notes: [
              { id: 'not_12345678901234', title: 'Customer call' },
              { id: 'not_abcdefghijklmn', title: 'Internal standup' }
            ]
          })
        };
      }

      if (url.includes('/v1/notes/not_12345678901234')) {
        return {
          ok: true,
          json: async () => ({
            id: 'not_12345678901234',
            title: 'Customer call',
            summary_markdown: 'Discussed launch blockers and next steps.',
            transcript: [{ text: 'The customer asked about launch readiness.' }],
            attendees: [{ email: 'founder@example.com' }]
          })
        };
      }

      return {
        ok: true,
        json: async () => ({
          id: 'not_abcdefghijklmn',
          title: 'Internal standup',
          summary_markdown: 'Normal daily sync.',
          transcript: [{ text: 'Routine updates.' }]
        })
      };
    }));

    const { getGranolaService, toArtifact } = await import('#lib/server/context-sources/granola');
    const granola = getGranolaService();
    const result = await granola.search('launch readiness', 3);

    expect(result.results).toHaveLength(1);
    expect(result.results[0]).toEqual(expect.objectContaining({ title: 'Customer call' }));
    expect(toArtifact(result.results[0])).toEqual(expect.objectContaining({ source: 'granola', type: 'meeting_note' }));
  });
});
