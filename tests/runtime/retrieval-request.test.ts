import { describe, expect, it } from 'vitest';
import type { ContextAssembly } from '../../src/lib/types';
import {
  buildNormalizedRetrievalRequest,
  deterministicRetrievalInputForTool
} from '#lib/server/runtime/retrieval-request';

function releaseContext(): ContextAssembly {
  return {
    workspaceId: 'W1',
    task: {
      id: 'task-1',
      source: 'slack_event',
      workspaceId: 'W1',
      thread: { provider: 'slack', channelId: 'C1', threadTs: '111.222' },
      targetUserId: 'UOWNER',
      receivedAt: new Date().toISOString()
    },
    targetUserId: 'UOWNER',
    thread: {
      ref: { provider: 'slack', channelId: 'C1', threadTs: '111.222' },
      latestMessage: '<@UOWNER> where are we on v0.9? trying to figure out if this is actually shippable or if there are still real blockers',
      recentMessages: [],
      participants: ['UASKER']
    },
    memory: {
      user: { userId: 'UOWNER', preferences: [], forbiddenTopics: [], routingHints: [] },
      workspace: {
        workspaceId: 'W1',
        channelMappings: [],
        escalationRules: [],
        enabledOptionalTools: [],
        enabledContextSources: [],
        enabledPlugins: []
      },
      thread: {
        workspaceId: 'W1',
        channelId: 'C1',
        threadTs: '111.222',
        linkedArtifacts: [],
        openQuestions: [],
        blockerNotes: []
      }
    },
    skills: [],
    availableTools: [],
    artifacts: [{
      id: 'notion:release-plan',
      source: 'notion',
      type: 'document',
      title: '[TEST] Murph v0.9 Release Plan',
      text: '[TEST] Murph v0.9 Release Plan\nF2 dark mode PR #6 needs contrast check. F5 evidence trail is still todo. Linear issues MUR-5 through MUR-9 track the release.'
    }],
    linkedArtifacts: [],
    continuityCase: 'clarification',
    summary: '',
    unresolvedQuestions: [],
  };
}

describe('normalized retrieval requests', () => {
  it('turns a vague release status request into source-aware candidates', () => {
    const request = buildNormalizedRetrievalRequest(releaseContext());

    expect(request.intentQuery).toBe('trying figure out actually shippable still real blockers');
    expect(request.entityTerms).toEqual(expect.arrayContaining(['Murph v0.9', '[TEST]', 'F2', 'F5', 'MUR-5']));
    expect(request.sourceTerms).toEqual(expect.arrayContaining(['[TEST] Murph v0.9 Release Plan']));
    expect(request.candidateQueries).toEqual(expect.arrayContaining([
      '[TEST] Murph v0.9 Release Plan',
      '[TEST] Murph v0.9',
      'Murph v0.9'
    ]));
  });

  it('keeps the existing deterministic retrieval schema guardrails', () => {
    const request = buildNormalizedRetrievalRequest(releaseContext());

    expect(deterministicRetrievalInputForTool({
      name: 'linear_search_issues',
      description: '',
      sideEffectClass: 'read',
      inputSchema: {
        type: 'object',
        required: ['query'],
        properties: { query: { type: 'string' }, limit: { type: 'number' } }
      }
    }, request)).toEqual({ query: 'Murph v0.9', limit: 5 });
    expect(deterministicRetrievalInputForTool({
      name: 'needs.extra',
      description: '',
      sideEffectClass: 'read',
      inputSchema: {
        type: 'object',
        required: ['query', 'projectId'],
        properties: { query: { type: 'string' }, projectId: { type: 'string' } }
      }
    }, request)).toBeUndefined();
  });
});
