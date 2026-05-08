import { describe, expect, it } from 'vitest';
import { JsonPromptProvider } from '../../src/lib/server/providers/base';
import type { ContextAssembly, ProviderDraftResult } from '../../src/lib/types';

function context(overrides: Partial<Omit<ContextAssembly, 'summary' | 'unresolvedQuestions' | 'continuityCase'>> = {}): Omit<ContextAssembly, 'summary' | 'unresolvedQuestions' | 'continuityCase'> {
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
      latestMessage: 'Are we clear to go live?',
      recentMessages: [],
      participants: []
    },
    memory: {
      user: { userId: 'owner', preferences: [], forbiddenTopics: [], routingHints: [] },
      workspace: {
        workspaceId: 'workspace',
        channelMappings: [],
        escalationRules: [],
        enabledOptionalTools: [],
        enabledContextSources: [],
        enabledPlugins: []
      },
      thread: {
        workspaceId: 'workspace',
        channelId: 'channel',
        threadTs: '1.0',
        linkedArtifacts: [],
        openQuestions: [],
        blockerNotes: []
      }
    },
    skills: [],
    availableTools: [],
    linkedArtifacts: [],
    artifacts: [],
    ...overrides
  };
}

class TestPromptProvider extends JsonPromptProvider {
  readonly name = 'openai' as const;

  promptFor(input: Omit<ContextAssembly, 'summary' | 'unresolvedQuestions' | 'continuityCase'>): string {
    return this.buildPrompt(input);
  }

  async summarizeAndPropose(): Promise<ProviderDraftResult> {
    throw new Error('not implemented');
  }
}

describe('JsonPromptProvider prompt', () => {
  it('includes shared Murph response style guidance for fallback drafts', () => {
    const prompt = new TestPromptProvider().promptFor(context());

    expect(prompt).toContain('You are Murph');
    expect(prompt).toContain('Write like a teammate in the channel, not a chatbot.');
    expect(prompt).toContain('Use simple words and 1-3 short sentences by default.');
    expect(prompt).toContain('Avoid filler like "certainly"');
    expect(prompt).toContain('If uncertain, say what is missing and defer instead of padding.');
  });
});
