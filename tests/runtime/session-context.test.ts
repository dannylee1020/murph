import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AutopilotSession, ToolDefinition, Workspace, WorkspaceMemory } from '../../src/lib/types';

const workspace: Workspace = {
  id: 'W1',
  provider: 'slack',
  externalWorkspaceId: 'T1',
  name: 'Workspace'
};

const session: AutopilotSession = {
  id: 'S1',
  workspaceId: workspace.id,
  ownerUserId: 'U1',
  title: 'Coverage',
  mode: 'manual_review',
  status: 'active',
  channelScope: [],
  startedAt: new Date().toISOString(),
  endsAt: new Date(Date.now() + 1000).toISOString()
};

const workspaceMemory: WorkspaceMemory = {
  workspaceId: workspace.id,
  channelMappings: [],
  escalationRules: [],
  enabledOptionalTools: [
    'notion.search',
    'notion.read_page',
    'github.search',
    'calendar.search_events'
  ],
  enabledContextSources: [],
  enabledPlugins: []
};

function tool<TInput, TOutput>(definition: ToolDefinition<TInput, TOutput>): ToolDefinition<TInput, TOutput> {
  return {
    sideEffectClass: 'read',
    retrievalEligible: true,
    optional: true,
    requiresWorkspaceEnablement: true,
    supportsDryRun: true,
    ...definition
  };
}

describe('SessionContextBuilder', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('builds a session context from the named Notion handoff and same-day sources', async () => {
    const { getToolRegistry } = await import('#lib/server/capabilities/tool-registry');
    const { SessionContextBuilder } = await import('#lib/server/runtime/session-context');
    const registry = getToolRegistry();

    registry.register(tool({
      name: 'notion.search',
      description: 'Search Notion',
      async execute() {
        return { results: [{ id: 'page-1', title: 'Murph Handoff 2026-05-07', url: 'https://notion.test/page-1' }] };
      }
    }));
    registry.register(tool({
      name: 'notion.read_page',
      description: 'Read Notion page',
      retrievalEligible: false,
      async execute() {
        return { title: 'Murph Handoff 2026-05-07', url: 'https://notion.test/page-1', text: 'Launch is waiting on QA.' };
      }
    }));
    registry.register(tool({
      name: 'github.search',
      description: 'Search GitHub',
      async execute() {
        return { results: [{ title: 'Fix checkout launch bug', body: 'PR updated today', url: 'https://github.test/pr' }] };
      }
    }));
    registry.register(tool({
      name: 'calendar.search_events',
      description: 'Search Calendar',
      async execute() {
        return { events: [{ title: 'Launch sync', start: '2026-05-07T17:00:00Z', end: '2026-05-07T18:00:00Z' }] };
      }
    }));

    const context = await new SessionContextBuilder().build({
      workspace,
      session,
      workspaceMemory,
      timezone: 'UTC'
    });

    expect(context.handoffDoc?.title).toContain('Murph Handoff');
    expect(context.sections.map((section) => section.source)).toEqual(['notion', 'github', 'calendar']);
    expect(context.summary).toContain('Built session context');
    expect(context.warnings).toBeUndefined();
  });
});
