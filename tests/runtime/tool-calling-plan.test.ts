import { describe, expect, it } from 'vitest';
import { buildRuntimeToolCallingPlan } from '../../src/lib/server/runtime/tool-calling-plan';
import type { ContextAssembly, SkillManifest, ToolInventoryItem, WorkspaceMemory } from '../../src/lib/types';

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
    name: 'channel-continuity',
    description: '',
    triggers: ['status'],
    allowedActions: ['reply', 'ask', 'redirect', 'defer', 'remind', 'abstain'],
    toolNames: ['channel.fetch_thread', 'memory.thread.read'],
    channelNames: ['slack'],
    contextSourceNames: [],
    knowledgeRequirements: [],
    sessionModes: ['manual_review'],
    appliesTo: ['channel_thread'],
    priority: 100,
    riskLevel: 'low',
    abstainConditions: [],
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
    skills: [skill()],
    availableTools: [
      { name: 'channel.fetch_thread', description: '', sideEffectClass: 'read' },
      { name: 'memory.thread.read', description: '', sideEffectClass: 'read' }
    ],
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
  tool({ name: 'notion.search', sideEffectClass: 'read', optional: true, requiresWorkspaceEnablement: true, knowledgeDomains: ['documentation'] }),
  tool({ name: 'notion.read_page', sideEffectClass: 'read', optional: true, requiresWorkspaceEnablement: true, knowledgeDomains: ['documentation'] })
];

describe('buildRuntimeToolCallingPlan', () => {
  it('requires retrieval and broadens available tools for factual questions without artifacts', () => {
    const plan = buildRuntimeToolCallingPlan({ context: context(), allTools });

    expect(plan.retrievalPlan.required).toBe(true);
    expect(plan.availableTools.map((tool) => tool.name)).toEqual([
      'channel.fetch_thread',
      'memory.thread.read',
      'notion.search',
      'notion.read_page'
    ]);
    expect(plan.retrievalToolNames).toEqual(['notion.search', 'notion.read_page']);
  });

  it('does not require retrieval when artifacts already exist', () => {
    const plan = buildRuntimeToolCallingPlan({
      context: context({
        artifacts: [{ id: 'a1', source: 'notion', type: 'document', title: 'Checkout', text: 'ready' }]
      }),
      allTools
    });

    expect(plan.retrievalPlan.required).toBe(false);
    expect(plan.availableTools.map((tool) => tool.name)).toEqual(['channel.fetch_thread', 'memory.thread.read']);
  });
});
