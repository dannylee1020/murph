import type {
  AgentToolInventoryItem,
  ChannelProvider,
  SessionMode,
  SkillManifest,
  WorkspaceMemory
} from '#lib/types';

function hasAvailableContextSources(
  skill: SkillManifest,
  workspaceMemory: WorkspaceMemory
): boolean {
  const enabledContextSources = new Set(workspaceMemory.enabledContextSources);

  return (skill.contextSourceNames ?? []).every(
    (source) => enabledContextSources.has(source) || source === 'memory.linked_artifacts'
  );
}

/**
 * Selects every skill whose channel + sessionMode + capability constraints permit it.
 * Skills are NOT filtered by lexical trigger matching — the LLM reads the full set of
 * applicable skills as system-prompt guidance and decides which to follow.
 *
 * Empty selection is valid. Core continuity behavior belongs in the base runtime prompt;
 * skills are integration- or source-specific guidance.
 */
export function selectSkills(input: {
  skills: SkillManifest[];
  channel: ChannelProvider;
  sessionMode: SessionMode;
  tools: AgentToolInventoryItem[];
  workspaceMemory: WorkspaceMemory;
}): SkillManifest[] {
  const eligible = input.skills
    .filter((skill) => !skill.channelNames?.length || skill.channelNames.includes(input.channel))
    .filter((skill) => !skill.sessionModes?.length || skill.sessionModes.includes(input.sessionMode))
    .filter((skill) => hasAvailableContextSources(skill, input.workspaceMemory))
    .sort((a, b) => {
      if (b.priority !== a.priority) {
        return b.priority - a.priority;
      }
      return a.name.localeCompare(b.name);
    });

  return eligible;
}
