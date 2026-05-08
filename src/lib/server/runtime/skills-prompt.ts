import type { SkillManifest } from '#lib/types';

function describeGroundingPolicy(policy: SkillManifest['groundingPolicy']): string | undefined {
  switch (policy) {
    case 'required_when_no_artifacts':
      return 'You must retrieve evidence from all relevant sources before drafting a response.';
    case 'prefer_search':
      return 'Prefer calling a retrieval tool before drafting.';
    case 'model_choice':
    default:
      return undefined;
  }
}

function renderSkill(skill: SkillManifest): string {
  const lines: string[] = [];
  lines.push(`## ${skill.name}`);
  lines.push(skill.description);

  const grounding = describeGroundingPolicy(skill.groundingPolicy);
  if (grounding) {
    lines.push(`**Grounding:** ${grounding}`);
  }

  if (skill.riskLevel && skill.riskLevel !== 'low') {
    lines.push(`**Risk level:** ${skill.riskLevel}`);
  }

  const body = skill.instructions?.trim();
  if (body) {
    lines.push('');
    lines.push(body);
  }

  return lines.join('\n');
}

/**
 * Render selected skills as a readable system-prompt block.
 * Skills become guidance the LLM reads, not tool gates.
 */
export function buildSkillsSystemBlock(skills: SkillManifest[]): string {
  if (skills.length === 0) {
    return '';
  }

  const intro =
    skills.length === 1
      ? 'The following skill applies to this request. Follow its guidance:'
      : `The following ${skills.length} skills apply to this request. Follow the combined guidance:`;

  return [intro, '', ...skills.map(renderSkill)].join('\n\n');
}

/**
 * Returns a strict directive when any selected skill demands grounding before drafting
 * and no source evidence is already present in the current run.
 */
export function buildGroundingDirective(input: {
  skills: SkillManifest[];
  hasSourceArtifacts: boolean;
}): { required: boolean; reason: string } {
  if (input.hasSourceArtifacts) {
    return { required: false, reason: 'Current-run source artifacts already provide grounding for this thread.' };
  }

  const requiredSkill = input.skills.find(
    (skill) => skill.groundingPolicy === 'required_when_no_artifacts'
  );
  if (requiredSkill) {
    return {
      required: true,
      reason: `Skill "${requiredSkill.name}" requires retrieval grounding before drafting because no current-run source evidence is present.`
    };
  }

  const preferSearch = input.skills.find((skill) => skill.groundingPolicy === 'prefer_search');
  if (preferSearch) {
    return {
      required: false,
      reason: `Skill "${preferSearch.name}" prefers retrieval before drafting when relevant tools are available.`
    };
  }

  return { required: false, reason: 'No skill requires retrieval; answer from the provided context if sufficient.' };
}
