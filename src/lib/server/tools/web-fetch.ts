import type { ToolDefinition } from '#lib/types';

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function decodeEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

function stripHtml(html: string): { title?: string; text: string } {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? collapseWhitespace(decodeEntities(titleMatch[1])) : undefined;
  const text = collapseWhitespace(
    decodeEntities(
      html
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
        .replace(/<\/(p|div|section|article|li|h[1-6]|br)>/gi, '\n')
        .replace(/<[^>]+>/g, ' ')
    )
  );

  return {
    title,
    text
  };
}

export function createWebFetchTool(): ToolDefinition<
  { url: string; maxChars?: number },
  { url: string; status: number; contentType: string; title?: string; text: string; truncated: boolean }
> {
  return {
    name: 'web.fetch',
    description: 'Fetch the contents of an explicit URL and extract readable text.',
    sideEffectClass: 'read',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['url'],
      properties: {
        url: { type: 'string' },
        maxChars: { type: 'number' }
      }
    },
    knowledgeDomains: ['documentation', 'code', 'email', 'calendar', 'team', 'meeting', 'web'],
    retrievalEligible: false,
    optional: true,
    requiresWorkspaceEnablement: true,
    supportsDryRun: true,
    async execute(input) {
      const target = new URL(input.url);

      if (!['http:', 'https:'].includes(target.protocol)) {
        throw new Error('Only http(s) URLs are allowed');
      }

      const response = await fetch(target, {
        headers: {
          Accept: 'text/html, text/plain, application/xhtml+xml'
        }
      });
      const contentType = response.headers.get('content-type') ?? 'application/octet-stream';
      const raw = await response.text();
      const maxChars = Math.max(256, Math.min(input.maxChars ?? 12000, 50_000));
      const extracted = contentType.includes('html') ? stripHtml(raw) : { text: collapseWhitespace(raw) };
      const text = extracted.text.slice(0, maxChars);

      return {
        url: target.toString(),
        status: response.status,
        contentType,
        title: extracted.title,
        text,
        truncated: extracted.text.length > maxChars
      };
    }
  };
}
