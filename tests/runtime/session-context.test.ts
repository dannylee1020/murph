import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AutopilotSession, Workspace, WorkspaceMemory } from '../../src/lib/types';

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

describe('SessionContextBuilder', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('builds a session context from the named Notion handoff and same-day sources', async () => {
    const { registerAdapter } = await import('#lib/server/integrations/adapter-registry');
    const { SessionContextBuilder } = await import('#lib/server/runtime/session-context');

    registerAdapter({
      id: 'test-context',
      name: 'Test Context',
      description: 'Test session context adapter.',
      credential: {
        authType: 'api_key',
        credentialKind: 'api_key',
        envKey: 'TEST_CONTEXT_API_KEY',
        credentialLabel: 'API key'
      },
      isConfigured: () => true,
      sessionContext: {
        async contribute() {
          return {
            handoffDoc: {
              source: 'notion',
              title: 'Murph Handoff 2026-05-07',
              url: 'https://notion.test/page-1',
              text: 'Launch is waiting on QA.'
            },
            sections: [
              {
                source: 'notion',
                title: 'Murph Handoff 2026-05-07',
                summary: 'Launch is waiting on QA.',
                url: 'https://notion.test/page-1'
              },
              {
                source: 'github',
                title: 'Fix checkout launch bug',
                summary: 'PR updated today',
                url: 'https://github.test/pr'
              },
              {
                source: 'calendar',
                title: 'Launch sync',
                summary: '2026-05-07T17:00:00Z - 2026-05-07T18:00:00Z',
                metadata: {
                  start: '2026-05-07T17:00:00Z',
                  end: '2026-05-07T18:00:00Z'
                }
              }
            ]
          };
        }
      }
    }, { source: 'user' });

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
