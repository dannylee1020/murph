import type { ContextArtifact } from '#lib/types';

interface GmailThreadListResponse {
  threads?: Array<{ id: string }>;
}

interface GmailHeader {
  name?: string;
  value?: string;
}

interface GmailMessagePart {
  mimeType?: string;
  body?: { data?: string };
  headers?: GmailHeader[];
  parts?: GmailMessagePart[];
}

interface GmailMessage {
  id: string;
  threadId: string;
  snippet?: string;
  internalDate?: string;
  payload?: GmailMessagePart;
}

interface GmailThreadResponse {
  id: string;
  messages?: GmailMessage[];
  snippet?: string;
}

export interface GmailThreadResult {
  id: string;
  subject: string;
  snippet: string;
  participants: string[];
  latestDate?: string;
  messageCount: number;
  text: string;
}

function decodeBase64Url(value: string): string {
  return Buffer.from(value.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
}

function headerValue(headers: GmailHeader[] | undefined, name: string): string {
  return headers?.find((header) => header.name?.toLowerCase() === name.toLowerCase())?.value ?? '';
}

function extractText(part?: GmailMessagePart): string {
  if (!part) {
    return '';
  }

  if (part.mimeType?.startsWith('text/plain') && part.body?.data) {
    return decodeBase64Url(part.body.data);
  }

  return (part.parts ?? []).map((child) => extractText(child)).join('\n');
}

function compact(value: string | undefined, limit = 6000): string {
  return (value ?? '').replace(/\s+/g, ' ').trim().slice(0, limit);
}

export function toArtifact(thread: GmailThreadResult): ContextArtifact {
  return {
    id: `gmail:${thread.id}`,
    source: 'gmail',
    type: 'email',
    title: thread.subject || 'Untitled email thread',
    text: thread.text || thread.snippet || thread.subject,
    metadata: {
      participants: thread.participants,
      latestDate: thread.latestDate,
      messageCount: thread.messageCount
    }
  };
}

export class GmailService {
  async search(accessToken: string, query: string, limit = 3): Promise<{ results: GmailThreadResult[] }> {
    const url = new URL('https://gmail.googleapis.com/gmail/v1/users/me/threads');
    url.searchParams.set('q', query);
    url.searchParams.set('maxResults', String(Math.max(1, Math.min(limit, 10))));
    const list = await this.fetchJson<GmailThreadListResponse>(accessToken, url.toString());
    const threads = await Promise.all((list.threads ?? []).map((thread) => this.readThread(accessToken, thread.id)));

    return { results: threads };
  }

  async readThread(accessToken: string, threadId: string): Promise<GmailThreadResult> {
    const url = new URL(`https://gmail.googleapis.com/gmail/v1/users/me/threads/${threadId}`);
    url.searchParams.set('format', 'full');
    const thread = await this.fetchJson<GmailThreadResponse>(accessToken, url.toString());
    const messages = thread.messages ?? [];
    const latest = messages.at(-1);
    const subject = headerValue(latest?.payload?.headers, 'subject');
    const participants = [...new Set(messages.flatMap((message) => {
      const headers = message.payload?.headers;
      return [headerValue(headers, 'from'), headerValue(headers, 'to')].filter(Boolean);
    }))];
    const text = compact(messages.map((message) => extractText(message.payload) || message.snippet || '').join('\n\n'));

    return {
      id: thread.id,
      subject: subject || 'Untitled email thread',
      snippet: compact(thread.snippet, 400),
      participants,
      latestDate: latest?.internalDate,
      messageCount: messages.length,
      text
    };
  }

  private async fetchJson<T>(accessToken: string, url: string): Promise<T> {
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    const payload = await response.json().catch(() => ({})) as T & { error?: { message?: string } };

    if (!response.ok) {
      throw new Error(payload.error?.message ?? `Gmail request failed with ${response.status}`);
    }

    return payload;
  }
}

let singleton: GmailService | null = null;

export function getGmailService(): GmailService {
  if (!singleton) {
    singleton = new GmailService();
  }

  return singleton;
}
