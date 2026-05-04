import type {
  AgentToolInventoryItem,
  ChannelProvider,
  SessionMode,
  SkillManifest,
  WorkspaceMemory
} from '#lib/types';

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

  const hasTools = skill.toolNames.every(
    (tool) => availableTools.has(tool) || optionalTools.has(tool)
  );
  const hasContextSources = (skill.contextSourceNames ?? []).every(
    (source) => enabledContextSources.has(source) || source === 'memory.linked_artifacts'
  );

  return hasTools && hasContextSources;
}

/**
 * Selects every skill whose channel + sessionMode + capability constraints permit it.
 * Skills are NOT filtered by lexical trigger matching — the LLM reads the full set of
 * applicable skills as system-prompt guidance and decides which to follow.
 *
 * The fallback skill (channel-continuity) is always present so the agent always has a
 * baseline reply policy to fall back on.
 */
export function selectSkills(input: {
  skills: SkillManifest[];
  channel: ChannelProvider;
  sessionMode: SessionMode;
  tools: AgentToolInventoryItem[];
  workspaceMemory: WorkspaceMemory;
  fallbackSkillName?: string;
}): SkillManifest[] {
  const fallbackSkillName = input.fallbackSkillName ?? 'channel-continuity';
  const fallback = input.skills.find((skill) => skill.name === fallbackSkillName);

  const eligible = input.skills
    .filter((skill) => !skill.channelNames?.length || skill.channelNames.includes(input.channel))
    .filter((skill) => !skill.sessionModes.length || skill.sessionModes.includes(input.sessionMode))
    .filter((skill) => hasAvailableCapabilities(skill, input.tools, input.workspaceMemory, fallbackSkillName))
    .sort((a, b) => {
      if (b.priority !== a.priority) {
        return b.priority - a.priority;
      }
      return a.name.localeCompare(b.name);
    });

  if (fallback && !eligible.some((skill) => skill.name === fallback.name)) {
    eligible.push(fallback);
  }

  return eligible;
}
