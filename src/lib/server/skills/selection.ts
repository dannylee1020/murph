import type { AgentToolInventoryItem, ChannelProvider, SessionMode, SkillManifest, WorkspaceMemory } from '#lib/types';

const RISK_RANK: Record<SkillManifest['riskLevel'], number> = {
  low: 0,
  medium: 1,
  high: 2
};

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/<@([a-z0-9]+)>/gi, ' @user ')
    .replace(/[^\p{L}\p{N}@\s-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function triggerScore(text: string, triggers: string[]): number {
  const normalized = normalizeText(text);

  return triggers.reduce((score, trigger) => {
    if (trigger.startsWith('regex:')) {
      try {
        return new RegExp(trigger.slice('regex:'.length), 'i').test(text) ? score + 1 : score;
      } catch {
        return score;
      }
    }

    const phrase = normalizeText(trigger);
    if (!phrase) {
      return score;
    }

    const pattern = new RegExp(`(?:^|\\s)${escapeRegExp(phrase)}(?:\\s|$)`, 'i');
    return pattern.test(normalized) ? score + 1 : score;
  }, 0);
}

function hasAvailableCapabilities(
  skill: SkillManifest,
  tools: AgentToolInventoryItem[],
  workspaceMemory: WorkspaceMemory,
  fallbackSkillName: string
): boolean {
  if (skill.name === fallbackSkillName) {
    return true;
  }

  const availableTools = new Set(tools.map((tool) => tool.name));
  const optionalTools = new Set(workspaceMemory.enabledOptionalTools);
  const enabledContextSources = new Set(workspaceMemory.enabledContextSources);

  const hasTools = skill.toolNames.every((tool) => availableTools.has(tool) || optionalTools.has(tool));
  const hasContextSources = (skill.contextSourceNames ?? []).every((source) => enabledContextSources.has(source) || source === 'memory.linked_artifacts');

  return hasTools && hasContextSources;
}

export function selectSkills(input: {
  skills: SkillManifest[];
  latestMessage: string;
  channel: ChannelProvider;
  sessionMode: SessionMode;
  tools: AgentToolInventoryItem[];
  workspaceMemory: WorkspaceMemory;
  fallbackSkillName?: string;
  limit?: number;
}): SkillManifest[] {
  const fallbackSkillName = input.fallbackSkillName ?? 'channel-continuity';
  const fallback = input.skills.find((skill) => skill.name === fallbackSkillName);
  const scored = input.skills
    .filter((skill) => !skill.channelNames?.length || skill.channelNames.includes(input.channel))
    .filter((skill) => !skill.sessionModes.length || skill.sessionModes.includes(input.sessionMode))
    .filter((skill) => hasAvailableCapabilities(skill, input.tools, input.workspaceMemory, fallbackSkillName))
    .map((skill) => ({
      skill,
      score: triggerScore(input.latestMessage, skill.triggers)
    }))
    .filter((entry) => entry.score > 0 || entry.skill.name === fallbackSkillName)
    .sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }

      if (b.skill.priority !== a.skill.priority) {
        return b.skill.priority - a.skill.priority;
      }

      return RISK_RANK[a.skill.riskLevel] - RISK_RANK[b.skill.riskLevel];
    })
    .map((entry) => entry.skill);

  const selected = scored.slice(0, input.limit ?? 3);

  if (fallback && !selected.some((skill) => skill.name === fallback.name)) {
    selected.push(fallback);
  }

  return selected.slice(0, input.limit ?? 3);
}
