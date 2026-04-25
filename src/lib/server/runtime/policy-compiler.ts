import type {
  CompiledPolicy,
  ContinuityActionType,
  PolicyProfile,
  SessionMode,
  UserPolicyProfile
} from '#lib/types';

type PolicyPatch = {
  blockedTopics?: string[];
  alwaysQueueTopics?: string[];
  blockedActions?: ContinuityActionType[];
  requireGroundingForFacts?: boolean;
  preferAskWhenUncertain?: boolean;
  allowAutoSend?: boolean;
  notesForAgent?: string[];
};

const ACTIONS: ContinuityActionType[] = ['reply', 'ask', 'redirect', 'defer', 'remind', 'abstain'];

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function splitList(value: string): string[] {
  return value
    .split(/[,\n;]/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function matchList(raw: string, labels: string[]): string[] {
  for (const label of labels) {
    const pattern = new RegExp(`${label}\\s*:\\s*([^\\n]+)`, 'i');
    const match = raw.match(pattern);
    if (match?.[1]) {
      return splitList(match[1]).map((entry) => entry.toLowerCase());
    }
  }
  return [];
}

function detectActions(raw: string, labels: string[]): ContinuityActionType[] {
  const matched = matchList(raw, labels);
  return ACTIONS.filter((action) => matched.includes(action));
}

function detectBoolean(raw: string, labels: string[], fallback?: boolean): boolean | undefined {
  for (const label of labels) {
    const pattern = new RegExp(`${label}\\s*:\\s*(yes|no|true|false)`, 'i');
    const match = raw.match(pattern);
    if (match?.[1]) {
      return /^(yes|true)$/i.test(match[1]);
    }
  }
  return fallback;
}

function implicitTopics(raw: string, phrases: string[]): string[] {
  const lower = raw.toLowerCase();
  return phrases.filter((phrase) => lower.includes(phrase));
}

function canonicalize(compiled: CompiledPolicy): CompiledPolicy {
  return {
    blockedTopics: unique(compiled.blockedTopics),
    alwaysQueueTopics: unique(compiled.alwaysQueueTopics),
    blockedActions: [...new Set(compiled.blockedActions)],
    requireGroundingForFacts: compiled.requireGroundingForFacts,
    preferAskWhenUncertain: compiled.preferAskWhenUncertain,
    allowAutoSend: compiled.allowAutoSend,
    notesForAgent: unique(compiled.notesForAgent)
  };
}

function patchHasValues(patch: PolicyPatch): boolean {
  return Boolean(
    (patch.blockedTopics && patch.blockedTopics.length > 0) ||
      (patch.alwaysQueueTopics && patch.alwaysQueueTopics.length > 0) ||
      (patch.blockedActions && patch.blockedActions.length > 0) ||
      patch.requireGroundingForFacts !== undefined ||
      patch.preferAskWhenUncertain !== undefined ||
      patch.allowAutoSend !== undefined ||
      (patch.notesForAgent && patch.notesForAgent.length > 0)
  );
}

export function recommendedPolicyRaw(mode: SessionMode): string {
  if (mode === 'auto_send_low_risk') {
    return [
      'Always queue: launch decisions, customer escalations',
      'Block topics: payroll, legal, performance reviews',
      'Require grounding for facts: yes',
      'Prefer ask when uncertain: yes',
      'Allow auto-send: yes',
      'Notes: keep replies short and bounded to continuity'
    ].join('\n');
  }

  return [
    'Always queue: launch decisions, customer escalations',
    'Block topics: payroll, legal, performance reviews',
    'Require grounding for facts: yes',
    'Prefer ask when uncertain: yes',
    'Allow auto-send: no',
    'Notes: keep replies short and bounded to continuity'
  ].join('\n');
}

export function builtinPolicyProfile(mode: SessionMode): PolicyProfile {
  return {
    name: `builtin-${mode}`,
    description: 'Built-in fallback policy profile.',
    compiled: compilePolicy(recommendedPolicyRaw(mode), mode).compiled,
    source: 'builtin'
  };
}

export function compilePolicy(raw: string, mode: SessionMode): { compiled: CompiledPolicy; warnings: string[] } {
  const normalizedRaw = raw.trim() || recommendedPolicyRaw(mode);
  const warnings: string[] = [];
  const blockedTopics = unique([
    ...matchList(normalizedRaw, ['block topics', 'blocked topics', 'forbidden topics']),
    ...implicitTopics(normalizedRaw, ['payroll', 'legal', 'performance reviews'])
  ]);
  const alwaysQueueTopics = unique([
    ...matchList(normalizedRaw, ['always queue', 'queue topics', 'queue anything about']),
    ...implicitTopics(normalizedRaw, ['launch decisions', 'customer escalations'])
  ]);
  const blockedActions = detectActions(normalizedRaw, ['blocked actions', 'never do']);
  const requireGroundingForFacts =
    detectBoolean(normalizedRaw, ['require grounding for facts'], true) ?? true;
  const preferAskWhenUncertain =
    detectBoolean(normalizedRaw, ['prefer ask when uncertain'], true) ?? true;
  const allowAutoSend =
    detectBoolean(normalizedRaw, ['allow auto-send'], mode === 'auto_send_low_risk') ??
    mode === 'auto_send_low_risk';
  const notesForAgent = unique(matchList(normalizedRaw, ['notes', 'notes for agent']));

  if (!/:\s*/.test(normalizedRaw)) {
    warnings.push('Policy was interpreted using defaults because it did not match the recommended template.');
  }

  return {
    compiled: canonicalize({
      blockedTopics,
      alwaysQueueTopics,
      blockedActions,
      requireGroundingForFacts,
      preferAskWhenUncertain,
      allowAutoSend,
      notesForAgent
    }),
    warnings
  };
}

export function compilePolicyOverride(
  raw: string
): { patch: PolicyPatch; warnings: string[] } {
  const normalizedRaw = raw.trim();
  if (!normalizedRaw) {
    return { patch: {}, warnings: [] };
  }

  const patch: PolicyPatch = {
    blockedTopics: unique([
      ...matchList(normalizedRaw, ['block topics', 'blocked topics', 'forbidden topics']),
      ...implicitTopics(normalizedRaw, ['payroll', 'legal', 'performance reviews'])
    ]),
    alwaysQueueTopics: unique([
      ...matchList(normalizedRaw, ['always queue', 'queue topics', 'queue anything about']),
      ...implicitTopics(normalizedRaw, ['launch decisions', 'customer escalations'])
    ]),
    blockedActions: detectActions(normalizedRaw, ['blocked actions', 'never do']),
    requireGroundingForFacts: detectBoolean(normalizedRaw, ['require grounding for facts']),
    preferAskWhenUncertain: detectBoolean(normalizedRaw, ['prefer ask when uncertain']),
    allowAutoSend: detectBoolean(normalizedRaw, ['allow auto-send']),
    notesForAgent: unique(matchList(normalizedRaw, ['notes', 'notes for agent']))
  };

  const warnings: string[] = [];
  if (!patchHasValues(patch)) {
    warnings.push('Override did not match the supported policy fields, so the base profile was used unchanged.');
  }

  return { patch, warnings };
}

export function mergeCompiledPolicy(base: CompiledPolicy, patch: PolicyPatch): CompiledPolicy {
  return canonicalize({
    blockedTopics: [...base.blockedTopics, ...(patch.blockedTopics ?? [])],
    alwaysQueueTopics: [...base.alwaysQueueTopics, ...(patch.alwaysQueueTopics ?? [])],
    blockedActions: [...base.blockedActions, ...(patch.blockedActions ?? [])],
    requireGroundingForFacts: patch.requireGroundingForFacts ?? base.requireGroundingForFacts,
    preferAskWhenUncertain: patch.preferAskWhenUncertain ?? base.preferAskWhenUncertain,
    allowAutoSend: patch.allowAutoSend ?? base.allowAutoSend,
    notesForAgent: [...base.notesForAgent, ...(patch.notesForAgent ?? [])]
  });
}

export function resolveEffectivePolicy(input: {
  mode: SessionMode;
  baseProfile?: PolicyProfile;
  overrideRaw?: string;
}): { profile: PolicyProfile; compiled: CompiledPolicy; warnings: string[] } {
  const profile = input.baseProfile ?? builtinPolicyProfile(input.mode);
  const { patch, warnings } = compilePolicyOverride(input.overrideRaw ?? '');
  return {
    profile,
    compiled: mergeCompiledPolicy(profile.compiled, patch),
    warnings
  };
}

export function buildUserPolicyProfile(input: {
  mode: SessionMode;
  profileName?: string;
  overrideRaw?: string;
  compiled: CompiledPolicy;
  source: UserPolicyProfile['source'];
}): UserPolicyProfile {
  return {
    profileName: input.profileName,
    overrideRaw: input.overrideRaw?.trim() || undefined,
    raw: input.overrideRaw?.trim() || '',
    compiled: canonicalize(input.compiled),
    compiledAt: new Date().toISOString(),
    source: input.source,
    version: 2
  };
}
