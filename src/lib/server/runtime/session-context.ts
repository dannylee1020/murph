import type {
  AutopilotSession,
  ContextArtifact,
  SessionContextSnapshot,
  Workspace,
  WorkspaceMemory
} from '#lib/types';
import { listAdapters } from '#lib/server/integrations/adapter-registry';

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

    for (const adapter of listAdapters()) {
      if (!adapter.sessionContext) {
        continue;
      }

      try {
        if (!adapter.isConfigured(input.workspace.id)) {
          continue;
        }

        const contribution = await adapter.sessionContext.contribute({
          workspace: input.workspace,
          session: input.session,
          workspaceMemory: input.workspaceMemory,
          date,
          nextDate: nextDate(date),
          timezone: input.timezone
        });
        sections.push(...(contribution.sections ?? []));
        handoffDoc ??= contribution.handoffDoc;
      } catch (error) {
        warnings.push(`${adapter.id}: ${error instanceof Error ? error.message : 'failed'}`);
      }
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
