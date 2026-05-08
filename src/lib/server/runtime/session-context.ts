import type {
  AutopilotSession,
  ContextArtifact,
  SessionContextSnapshot,
  Workspace,
  WorkspaceMemory
} from '#lib/types';
import { getToolRegistry } from '#lib/server/capabilities/tool-registry';

type SourceName = SessionContextSnapshot['sections'][number]['source'];

function compact(value: unknown, limit = 1200): string {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  const normalized = (text ?? '').replace(/\s+/g, ' ').trim();
  return normalized.length > limit ? `${normalized.slice(0, limit - 3)}...` : normalized;
}

function localDate(timezone = 'UTC', date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date);
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? '01';
  return `${value('year')}-${value('month')}-${value('day')}`;
}

function nextDate(date: string): string {
  const next = new Date(`${date}T00:00:00.000Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString().slice(0, 10);
}

function section(
  source: SourceName,
  title: string,
  summary: unknown,
  extra: Pick<SessionContextSnapshot['sections'][number], 'url' | 'metadata'> = {}
): SessionContextSnapshot['sections'][number] {
  return {
    source,
    title,
    summary: compact(summary),
    ...extra
  };
}

function sessionContextToText(context: SessionContextSnapshot): string {
  const lines = [
    `Session context for ${context.date}`,
    context.summary,
    context.handoffDoc ? `Handoff doc: ${context.handoffDoc.title}\n${context.handoffDoc.text}` : ''
  ];

  for (const entry of context.sections) {
    lines.push(`${entry.source}: ${entry.title}\n${entry.summary}`);
  }

  return lines.filter(Boolean).join('\n\n');
}

export function sessionContextToArtifact(context: SessionContextSnapshot): ContextArtifact {
  return {
    id: `session-context:${context.date}:${context.builtAt}`,
    source: 'session.context',
    type: 'document',
    title: `Session context for ${context.date}`,
    text: sessionContextToText(context),
    metadata: {
      builtAt: context.builtAt,
      date: context.date,
      sectionCount: context.sections.length,
      sources: [...new Set(context.sections.map((entry) => entry.source))]
    }
  };
}

export class SessionContextBuilder {
  private readonly tools = getToolRegistry();

  async build(input: {
    workspace: Workspace;
    session: AutopilotSession;
    workspaceMemory: WorkspaceMemory;
    timezone?: string;
  }): Promise<SessionContextSnapshot> {
    const date = localDate(input.timezone);
    const warnings: string[] = [];
    const sections: SessionContextSnapshot['sections'] = [];
    let handoffDoc: SessionContextSnapshot['handoffDoc'];

    const execute = async <T>(name: string, payload: unknown): Promise<T | undefined> => {
      if (!this.tools.has(name)) {
        return undefined;
      }
      try {
        return await this.tools.execute(name, payload, {
          workspace: input.workspace,
          session: input.session,
          workspaceMemory: input.workspaceMemory
        }) as T;
      } catch (error) {
        warnings.push(`${name}: ${error instanceof Error ? error.message : 'failed'}`);
        return undefined;
      }
    };

    const handoffSearch = await execute<{ results?: Array<{ id: string; title: string; url?: string }> }>(
      'notion.search',
      { query: `Murph Handoff ${date}`, limit: 3 }
    ) ?? await execute<{ results?: Array<{ id: string; title: string; url?: string }> }>(
      'notion.search',
      { query: 'Murph Handoff', limit: 3 }
    );
    const handoffMatch = handoffSearch?.results?.find((page) =>
      page.title.toLowerCase().includes('handoff')
    ) ?? handoffSearch?.results?.[0];

    if (handoffMatch) {
      const page = await execute<{ title: string; text: string; url?: string }>('notion.read_page', {
        pageId: handoffMatch.id,
        maxBlocks: 80
      });
      if (page) {
        handoffDoc = {
          source: 'notion',
          title: page.title,
          url: page.url,
          text: compact(page.text, 3000)
        };
        sections.push(section('notion', page.title, page.text, { url: page.url }));
      }
    } else if (this.tools.has('notion.search')) {
      warnings.push(`notion.handoff: no Murph Handoff page found for ${date}`);
    }

    const granola = await execute<{ results?: Array<{ title: string; summary?: string; scheduledStartTime?: string; id?: string }> }>(
      'granola.search',
      { query: date, limit: 5 }
    );
    for (const note of granola?.results ?? []) {
      sections.push(section('granola', note.title, note.summary ?? note.title, {
        metadata: { noteId: note.id, scheduledStartTime: note.scheduledStartTime }
      }));
    }

    const github = await execute<{ results?: Array<{ title: string; body?: string; url?: string; repository?: string; number?: number; kind?: string }> }>(
      'github.search',
      { query: `updated:${date}`, limit: 5 }
    );
    for (const item of github?.results ?? []) {
      sections.push(section('github', item.title, item.body ?? item.title, {
        url: item.url,
        metadata: { repository: item.repository, number: item.number, kind: item.kind }
      }));
    }

    const gmail = await execute<{ results?: Array<{ subject: string; snippet?: string; text?: string; id?: string; latestDate?: string }> }>(
      'gmail.search',
      { query: `after:${date.replaceAll('-', '/')} before:${nextDate(date).replaceAll('-', '/')}`, limit: 5 }
    );
    for (const thread of gmail?.results ?? []) {
      sections.push(section('gmail', thread.subject, thread.text || thread.snippet || thread.subject, {
        metadata: { threadId: thread.id, latestDate: thread.latestDate }
      }));
    }

    const calendar = await execute<{ events?: Array<{ title: string; start?: string; end?: string }> }>(
      'calendar.search_events',
      {
        query: '',
        limit: 20,
        timeMin: `${date}T00:00:00.000Z`,
        timeMax: `${nextDate(date)}T00:00:00.000Z`
      }
    );
    for (const event of calendar?.events ?? []) {
      sections.push(section('calendar', event.title, `${event.start ?? ''} - ${event.end ?? ''}`.trim(), {
        metadata: { start: event.start, end: event.end }
      }));
    }

    const sourceCounts = [...new Set(sections.map((entry) => entry.source))]
      .map((sourceName) => `${sourceName}: ${sections.filter((entry) => entry.source === sourceName).length}`)
      .join(', ');

    return {
      builtAt: new Date().toISOString(),
      date,
      handoffDoc,
      sections,
      summary: sections.length > 0
        ? `Built session context from ${sections.length} item${sections.length === 1 ? '' : 's'}${sourceCounts ? ` (${sourceCounts})` : ''}.`
        : 'No connected source context was found for this session.',
      warnings: warnings.length > 0 ? warnings : undefined
    };
  }
}
