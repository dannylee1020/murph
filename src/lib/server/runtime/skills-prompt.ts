import type { SkillManifest } from '#lib/types';

function joinList(values: string[] | undefined): string | undefined {
  if (!values || values.length === 0) {
    return undefined;
  }
  return values.join(', ');
}

function describeGroundingPolicy(policy: SkillManifest['groundingPolicy']): string | undefined {
  switch (policy) {
    case 'required_when_no_artifacts':
      return 'Required when no linked artifacts are already attached to the thread.';
    case 'prefer_search':
      return 'Prefer calling a retrieval tool before drafting.';
    case 'model_choice':
      return 'Decide whether retrieval is needed based on the request.';
    default:
      return undefined;
  }
}

function renderSkill(skill: SkillManifest): string {
  const lines: string[] = [];
  lines.push(`## Skill: ${skill.name}`);
  lines.push(skill.description);

  const allowedActions = joinList(skill.allowedActions);
  if (allowedActions) {
    lines.push(`Allowed actions: ${allowedActions}`);
  }

  lines.push(`Risk level: ${skill.riskLevel}`);

  const grounding = describeGroundingPolicy(skill.groundingPolicy);
  if (grounding) {
    lines.push(`Grounding policy: ${grounding}`);
  }

  const knowledgeDomains = joinList(skill.knowledgeDomains);
  if (knowledgeDomains) {
    lines.push(`Knowledge domains: ${knowledgeDomains}`);
  }

  const abstain = joinList(skill.abstainConditions);
  if (abstain) {
    lines.push(`Abstain when: ${abstain}`);
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
      ? 'The following skill applies to this request. Read it carefully and follow its guidance:'
      : `The following ${skills.length} skills apply to this request. Read each one and follow the combined guidance:`;

  return [intro, '', ...skills.map(renderSkill)].join('\n\n');
}

/**
 * Returns a strict directive when any selected skill demands grounding before drafting
 * and the thread has no linked artifacts. Caller decides whether to inject it into the prompt.
 */
export function buildGroundingDirective(input: {
  skills: SkillManifest[];
  hasArtifacts: boolean;
}): { required: boolean; reason: string } {
  if (input.hasArtifacts) {
    return { required: false, reason: 'Linked artifacts already provide grounding for this thread.' };
  }

  const requiredSkill = input.skills.find(
    (skill) => skill.groundingPolicy === 'required_when_no_artifacts'
  );
  if (requiredSkill) {
    return {
      required: true,
      reason: `Skill "${requiredSkill.name}" requires retrieval grounding before drafting because no artifacts are linked to this thread.`
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
