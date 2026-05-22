import { describe, expect, it } from 'vitest';
import {
  buildRuntimeToolCallingPlan,
  listAvailableTools
} from '../../src/lib/server/runtime/tool-calling-plan';
import type { CompiledPolicy, ContextAssembly, SkillManifest, ToolInventoryItem, WorkspaceMemory } from '../../src/lib/types';

const workspaceMemory: WorkspaceMemory = {
  workspaceId: 'workspace',
  channelMappings: [],
  escalationRules: [],
  enabledOptionalTools: ['notion.search', 'notion.read_page'],
  enabledContextSources: [],
  enabledPlugins: []
};

function skill(overrides: Partial<SkillManifest> = {}): SkillManifest {
  return {
    name: 'notion-docs',
    description: '',
    channelNames: ['slack'],
    sessionModes: ['manual_review'],
    priority: 100,
    riskLevel: 'low',
    instructions: '',
    ...overrides
  };
}

function tool(input: Partial<ToolInventoryItem> & Pick<ToolInventoryItem, 'name' | 'sideEffectClass'>): ToolInventoryItem {
  return {
    description: input.name,
    optional: false,
    source: 'test',
    ...input
  };
}

function policy(overrides: Partial<CompiledPolicy> = {}): CompiledPolicy {
  return {
    blockedTopics: [],
    alwaysQueueTopics: [],
    blockedActions: [],
    requireGroundingForFacts: true,
    preferAskWhenUncertain: false,
    allowAutoSend: true,
    notesForAgent: [],
    ...overrides
  };
}

function context(overrides: Partial<ContextAssembly> = {}): ContextAssembly {
  return {
    workspaceId: 'workspace',
    task: {
      id: 'task',
      source: 'slack_event',
      workspaceId: 'workspace',
      thread: { provider: 'slack', channelId: 'channel', threadTs: '1.0' },
      targetUserId: 'owner',
      receivedAt: new Date().toISOString()
    },
    targetUserId: 'owner',
    thread: {
      ref: { provider: 'slack', channelId: 'channel', threadTs: '1.0' },
      latestMessage: 'Is checkout ready to launch?',
      recentMessages: [],
      participants: []
    },
    memory: {
      user: { userId: 'owner', preferences: [], forbiddenTopics: [], routingHints: [] },
      workspace: workspaceMemory,
      thread: {
        workspaceId: 'workspace',
        channelId: 'channel',
        threadTs: '1.0',
        linkedArtifacts: [],
        openQuestions: [],
        blockerNotes: []
      }
    },
    artifacts: [],
    skills: [],
    availableTools: [],
    summary: '',
    unresolvedQuestions: [],
    continuityCase: 'status_request',
    linkedArtifacts: [],
    ...overrides
  };
}

const allTools: ToolInventoryItem[] = [
  tool({ name: 'channel.fetch_thread', sideEffectClass: 'read' }),
  tool({ name: 'memory.thread.read', sideEffectClass: 'read' }),
  tool({
    name: 'notion.search',
    sideEffectClass: 'read',
    optional: true,
    requiresWorkspaceEnablement: true,
    knowledgeDomains: ['documentation'],
    retrievalEligible: true,
    retrieval: { profile: 'title_keywords' }
  }),
  tool({
    name: 'notion.read_page',
    sideEffectClass: 'read',
    optional: true,
    requiresWorkspaceEnablement: true,
    knowledgeDomains: ['documentation'],
    retrievalEligible: false
  }),
  tool({
    name: 'web.search',
    sideEffectClass: 'read',
    optional: true,
    requiresWorkspaceEnablement: true,
    knowledgeDomains: ['web'],
    retrievalEligible: true
  })
];

describe('listAvailableTools', () => {
  it('exposes only tools the workspace has enabled', () => {
    const result = listAvailableTools({ allTools, workspaceMemory });

    expect(result.availableTools.map((t) => t.name)).toEqual([
      'channel.fetch_thread',
      'memory.thread.read',
      'notion.search',
      'notion.read_page'
    ]);
    expect(result.retrievalToolNames).toEqual(['notion.search']);
    expect(result.availableTools.find((t) => t.name === 'notion.search')?.retrieval).toEqual({ profile: 'title_keywords' });
  });

  it('hides workspace-enablement-required tools when not allowlisted', () => {
    const result = listAvailableTools({
      allTools,
      workspaceMemory: { ...workspaceMemory, enabledOptionalTools: [] }
    });

    expect(result.availableTools.map((t) => t.name)).toEqual([
      'channel.fetch_thread',
      'memory.thread.read'
    ]);
    expect(result.retrievalToolNames).toEqual([]);
  });
});

describe('buildRuntimeToolCallingPlan', () => {
  it('marks grounding required when a skill demands it and no artifacts are linked', () => {
    const plan = buildRuntimeToolCallingPlan({
      context: context({
        skills: [skill({ groundingPolicy: 'required_when_no_artifacts' })]
      }),
      allTools
    });

    expect(plan.groundingDirective.required).toBe(true);
    expect(plan.availableTools.map((t) => t.name)).toEqual(['runtime.retrieve_all']);
    expect(plan.retrievalToolNames).toEqual(['runtime.retrieve_all']);
    expect(plan.fanoutTools.map((t) => t.name)).toEqual(['notion.search']);
  });

  it('does not require grounding when source artifacts already exist in the current run', () => {
    const plan = buildRuntimeToolCallingPlan({
      context: context({
        skills: [skill({ groundingPolicy: 'required_when_no_artifacts' })],
        artifacts: [{ id: 'a1', source: 'notion', type: 'document', title: 'Checkout', text: 'ready' }]
      }),
      allTools
    });

    expect(plan.groundingDirective.required).toBe(false);
  });

  it('still requires grounding when only thread memory summary contains a factual claim', () => {
    const plan = buildRuntimeToolCallingPlan({
      context: context({
        skills: [skill({ groundingPolicy: 'required_when_no_artifacts' })],
        memory: {
          ...context().memory,
          thread: {
            ...context().memory.thread,
            summary: 'Calendar checks show next Thursday is unavailable.'
          }
        }
      }),
      allTools
    });

    expect(plan.groundingDirective.required).toBe(true);
  });

  it('marks grounding required when selected policy requires factual grounding', () => {
    const plan = buildRuntimeToolCallingPlan({
      context: context(),
      allTools,
      policy: policy()
    });

    expect(plan.groundingDirective.required).toBe(true);
    expect(plan.groundingDirective.reason).toMatch(/Runtime grounding configuration/);
    expect(plan.retrievalToolNames).toEqual(['runtime.retrieve_all']);
    expect(plan.fanoutTools.map((t) => t.name)).toEqual(['notion.search']);
  });

  it('does not require policy grounding when source artifacts already exist', () => {
    const plan = buildRuntimeToolCallingPlan({
      context: context({
        artifacts: [{ id: 'a1', source: 'notion', type: 'document', title: 'Checkout', text: 'ready' }]
      }),
      allTools,
      policy: policy()
    });

    expect(plan.groundingDirective.required).toBe(false);
  });

});
