import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ContextArtifact } from '../../src/lib/types';

async function loadRegistry() {
  vi.resetModules();
  const module = await import('../../src/lib/server/capabilities/context-source-registry');
  return module.getContextSourceRegistry();
}

function baseInput() {
  return {
    workspace: { id: 'T1', slackTeamId: 'T1', name: 'Test' },
    task: {
      id: 'task-1',
      source: 'slack_event' as const,
      workspaceId: 'T1',
      thread: { provider: 'slack' as const, channelId: 'C1', threadTs: '111.222' },
      targetUserId: 'U1',
      receivedAt: new Date().toISOString()
    },
    context: {
      workspaceId: 'T1',
      task: {
        id: 'task-1',
        source: 'slack_event' as const,
        workspaceId: 'T1',
        thread: { provider: 'slack' as const, channelId: 'C1', threadTs: '111.222' },
        targetUserId: 'U1',
        receivedAt: new Date().toISOString()
      },
      targetUserId: 'U1',
      thread: {
        ref: { provider: 'slack' as const, channelId: 'C1', threadTs: '111.222' },
        latestMessage: 'launch status',
        recentMessages: [],
        participants: []
      },
      memory: {
        workspace: {
          workspaceId: 'T1',
          channelMappings: [],
          escalationRules: [],
          enabledOptionalTools: [],
          enabledContextSources: ['optional.a', 'optional.b', 'optional.c'],
          enabledPlugins: []
        },
        thread: {
          workspaceId: 'T1',
          channelId: 'C1',
          threadTs: '111.222',
          linkedArtifacts: [],
          openQuestions: [],
          blockerNotes: []
        }
      },
      skills: [],
      availableTools: [],
      linkedArtifacts: []
    },
    enabledContextSources: ['optional.a', 'optional.b', 'optional.c']
  };
}

describe('ContextSourceRegistry.retrieve', () => {
  afterEach(() => {
    delete process.env.MURPH_CONTEXT_SOURCE_MAX_OPTIONAL;
    delete process.env.MURPH_CONTEXT_SOURCE_TIMEOUT_MS;
  });

  it('runs explicit sources first and caps optional sources', async () => {
    process.env.MURPH_CONTEXT_SOURCE_MAX_OPTIONAL = '2';
    const registry = await loadRegistry();
    const seen: string[] = [];

    function artifact(id: string): ContextArtifact {
      return { id, source: id, type: 'document', title: id, text: id };
    }

    registry.register({
      name: 'explicit.source',
      description: '',
      optional: false,
      async retrieve() {
        seen.push('explicit.source');
        return [artifact('explicit.source')];
      }
    }, { optional: false, source: 'test' });
    for (const name of ['optional.a', 'optional.b', 'optional.c']) {
      registry.register({
        name,
        description: '',
        optional: true,
        async retrieve() {
          seen.push(name);
          return [artifact(name)];
        }
      }, { optional: true, source: 'test' });
    }

    const artifacts = await registry.retrieve(['explicit.source'], ['optional.a', 'optional.b', 'optional.c'], baseInput());

    expect(seen).toEqual(['explicit.source', 'optional.a', 'optional.b']);
    expect(artifacts.map((entry) => entry.id)).toEqual(['explicit.source', 'optional.a', 'optional.b']);
  });

  it('silently skips timed-out optional sources', async () => {
    process.env.MURPH_CONTEXT_SOURCE_TIMEOUT_MS = '1';
    const registry = await loadRegistry();

    registry.register({
      name: 'optional.slow',
      description: '',
      optional: true,
      async retrieve() {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return [{ id: 'slow', source: 'slow', type: 'document', title: 'slow', text: 'slow' }];
      }
    }, { optional: true, source: 'test' });

    const artifacts = await registry.retrieve([], ['optional.slow'], {
      ...baseInput(),
      enabledContextSources: ['optional.slow']
    });

    expect(artifacts).toEqual([]);
  });
});
