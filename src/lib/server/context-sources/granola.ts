import { getRuntimeEnv } from '#lib/server/util/env';
import type { ContextArtifact } from '#lib/types';

interface GranolaListResponse {
  notes?: GranolaListItem[];
}

interface GranolaListItem {
  id: string;
  title?: string | null;
  created_at?: string;
  updated_at?: string;
}

interface GranolaTranscriptChunk {
  text?: string;
}

interface GranolaNoteResponse {
  id: string;
  title?: string | null;
  summary_text?: string;
  summary_markdown?: string | null;
  transcript?: GranolaTranscriptChunk[] | null;
  attendees?: Array<{ email?: string; name?: string }>;
  calendar_event?: {
    event_title?: string;
    scheduled_start_time?: string;
    scheduled_end_time?: string;
  };
}

export interface GranolaNoteResult {
  id: string;
  title: string;
  summary: string;
  transcriptText: string;
  attendees: string[];
  scheduledStartTime?: string;
}

function compact(value: string | null | undefined, limit = 6000): string {
  return (value ?? '').replace(/\s+/g, ' ').trim().slice(0, limit);
}

function scoreNote(query: string, note: GranolaNoteResult): number {
  const tokens = [...new Set(query.toLowerCase().split(/[^a-z0-9]+/i).filter((token) => token.length >= 3))];
  const haystack = `${note.title}\n${note.summary}\n${note.transcriptText}`.toLowerCase();
  return tokens.reduce((score, token) => score + (haystack.includes(token) ? 1 : 0), 0);
}

export function toArtifact(note: GranolaNoteResult): ContextArtifact {
  return {
    id: `granola:${note.id}`,
    source: 'granola',
    type: 'meeting_note',
    title: note.title,
    text: note.summary || note.transcriptText || note.title,
    metadata: {
      attendees: note.attendees,
      scheduledStartTime: note.scheduledStartTime
    }
  };
}

export class GranolaService {
  private readonly env = getRuntimeEnv();

  isConfigured(): boolean {
    return Boolean(this.env.granolaApiKey);
  }

  async search(query: string, limit = 3): Promise<{ results: GranolaNoteResult[] }> {
    if (!this.env.granolaApiKey) {
      throw new Error('GRANOLA_API_KEY is not configured');
    }

    const list = await this.fetchJson<GranolaListResponse>('https://public-api.granola.ai/v1/notes?page_size=10');
    const notes = await Promise.all((list.notes ?? []).slice(0, 10).map((note) => this.readMeeting(note.id, false)));

    return {
      results: notes
        .map((note) => ({ note, score: scoreNote(query, note) }))
        .filter((entry) => entry.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, limit)
        .map((entry) => entry.note)
    };
  }

  async readMeeting(noteId: string, includeTranscript = true): Promise<GranolaNoteResult> {
    if (!this.env.granolaApiKey) {
      throw new Error('GRANOLA_API_KEY is not configured');
    }

    const suffix = includeTranscript ? '?include=transcript' : '';
    const note = await this.fetchJson<GranolaNoteResponse>(`https://public-api.granola.ai/v1/notes/${noteId}${suffix}`);
    return {
      id: note.id,
      title: compact(note.title, 200) || 'Untitled Granola note',
      summary: compact(note.summary_markdown ?? note.summary_text),
      transcriptText: compact((note.transcript ?? []).map((chunk) => chunk.text ?? '').join(' ')),
      attendees: (note.attendees ?? []).map((attendee) => attendee.email || attendee.name || '').filter(Boolean),
      scheduledStartTime: note.calendar_event?.scheduled_start_time
    };
  }

  private async fetchJson<T>(url: string): Promise<T> {
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${this.env.granolaApiKey}`
      }
    });
    const payload = await response.json().catch(() => ({})) as T & { message?: string };

    if (!response.ok) {
      throw new Error(payload.message ?? `Granola request failed with ${response.status}`);
    }

    return payload;
  }
}

let singleton: GranolaService | null = null;

export function getGranolaService(): GranolaService {
  if (!singleton) {
    singleton = new GranolaService();
  }

  return singleton;
}
