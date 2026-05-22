import type {
  CompiledPolicy,
  ContinuityCase,
  ContinuityActionType,
  PolicyControls,
  PolicyExecutionMode,
  PolicyProfile,
  ScopedPolicyRule,
  SessionMode,
  UserPolicyProfile
} from '#lib/types';

type PolicyPatch = PolicyControls;

const ACTIONS: ContinuityActionType[] = ['reply', 'ask', 'redirect', 'defer', 'remind', 'abstain'];
const POLICY_EXECUTION_MODES: PolicyExecutionMode[] = ['manual_review', 'auto_send_low_risk'];
const INTENTS: ContinuityCase[] = [
  'status_request',
  'clarification',
  'blocker',
  'handoff',
  'availability',
  'unknown'
];

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

function detectPolicyExecutionMode(raw: string): PolicyExecutionMode | undefined {
  for (const label of ['execution mode', 'executionMode', 'mode']) {
    const pattern = new RegExp(`${label}\\s*:\\s*([a-z_\\-]+)`, 'i');
    const match = raw.match(pattern);
    const normalized = normalizePolicyExecutionMode(match?.[1]);
    if (normalized) {
      return normalized;
    }
  }
  return undefined;
}

export function normalizePolicyExecutionMode(value: unknown): PolicyExecutionMode | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().toLowerCase().replace(/-/g, '_');
  return POLICY_EXECUTION_MODES.includes(normalized as PolicyExecutionMode)
    ? normalized as PolicyExecutionMode
    : undefined;
}

export function policyExecutionModeFromAllowAutoSend(allowAutoSend: boolean | undefined): PolicyExecutionMode {
  return allowAutoSend ? 'auto_send_low_risk' : 'manual_review';
}

export function policyExecutionModeFromSessionMode(mode: SessionMode): PolicyExecutionMode {
  return mode === 'auto_send_low_risk' ? 'auto_send_low_risk' : 'manual_review';
}

function implicitTopics(raw: string, phrases: string[]): string[] {
  const lower = raw.toLowerCase();
  return phrases.filter((phrase) => lower.includes(phrase));
}

export function normalizeCompiledPolicy(compiled: CompiledPolicy): CompiledPolicy {
  const executionMode =
    compiled.executionMode ?? policyExecutionModeFromAllowAutoSend(compiled.allowAutoSend);
  return {
    blockedTopics: unique(compiled.blockedTopics),
    alwaysQueueTopics: unique(compiled.alwaysQueueTopics),
    blockedActions: [...new Set(compiled.blockedActions)],
    executionMode,
    requireGroundingForFacts: compiled.requireGroundingForFacts,
    preferAskWhenUncertain: compiled.preferAskWhenUncertain,
    allowAutoSend: executionMode === 'auto_send_low_risk',
    notesForAgent: unique(compiled.notesForAgent),
    rules: normalizeScopedPolicyRules(compiled.rules ?? [])
  };
}

function patchHasValues(patch: PolicyPatch): boolean {
  return Boolean(
    (patch.blockedTopics && patch.blockedTopics.length > 0) ||
      (patch.alwaysQueueTopics && patch.alwaysQueueTopics.length > 0) ||
      (patch.blockedActions && patch.blockedActions.length > 0) ||
      patch.executionMode !== undefined ||
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
      'Mode: auto_send_low_risk',
      'Require grounding for facts: yes',
      'Prefer ask when uncertain: yes',
      'Allow auto-send: yes',
      'Notes: keep replies short and bounded to continuity'
    ].join('\n');
  }

  return [
    'Always queue: launch decisions, customer escalations',
    'Block topics: payroll, legal, performance reviews',
    'Mode: manual_review',
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
  const legacyAllowAutoSend = detectBoolean(normalizedRaw, ['allow auto-send'], mode === 'auto_send_low_risk') ??
    mode === 'auto_send_low_risk';
  const executionMode =
    detectPolicyExecutionMode(normalizedRaw) ?? policyExecutionModeFromAllowAutoSend(legacyAllowAutoSend);
  const notesForAgent = unique(matchList(normalizedRaw, ['notes', 'notes for agent']));

  if (!/:\s*/.test(normalizedRaw)) {
    warnings.push('Policy was interpreted using defaults because it did not match the recommended template.');
  }

  return {
    compiled: normalizeCompiledPolicy({
      blockedTopics,
      alwaysQueueTopics,
      blockedActions,
      executionMode,
      requireGroundingForFacts,
      preferAskWhenUncertain,
      allowAutoSend: executionMode === 'auto_send_low_risk',
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
    executionMode: detectPolicyExecutionMode(normalizedRaw),
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
  const executionMode =
    patch.executionMode ??
    (patch.allowAutoSend !== undefined ? policyExecutionModeFromAllowAutoSend(patch.allowAutoSend) : base.executionMode);
  return normalizeCompiledPolicy({
    blockedTopics: [...base.blockedTopics, ...(patch.blockedTopics ?? [])],
    alwaysQueueTopics: [...base.alwaysQueueTopics, ...(patch.alwaysQueueTopics ?? [])],
    blockedActions: [...base.blockedActions, ...(patch.blockedActions ?? [])],
    executionMode,
    requireGroundingForFacts: patch.requireGroundingForFacts ?? base.requireGroundingForFacts,
    preferAskWhenUncertain: patch.preferAskWhenUncertain ?? base.preferAskWhenUncertain,
    allowAutoSend: executionMode === 'auto_send_low_risk',
    notesForAgent: [...base.notesForAgent, ...(patch.notesForAgent ?? [])],
    rules: base.rules
  });
}

function listFromUnknown(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : [];
}

function booleanFromUnknown(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function normalizeControls(input: unknown): PolicyControls {
  const record = input && typeof input === 'object' ? input as Record<string, unknown> : {};
  const blockedActions = listFromUnknown(record.blockedActions)
    .filter((entry): entry is ContinuityActionType => ACTIONS.includes(entry as ContinuityActionType));

  return {
    blockedTopics: listFromUnknown(record.blockedTopics).map((entry) => entry.toLowerCase()),
    alwaysQueueTopics: listFromUnknown(record.alwaysQueueTopics).map((entry) => entry.toLowerCase()),
    blockedActions,
    executionMode: normalizePolicyExecutionMode(record.executionMode ?? record.mode),
    requireGroundingForFacts: booleanFromUnknown(record.requireGroundingForFacts),
    preferAskWhenUncertain: booleanFromUnknown(record.preferAskWhenUncertain),
    allowAutoSend: booleanFromUnknown(record.allowAutoSend),
    notesForAgent: listFromUnknown(record.notesForAgent)
  };
}

function controlsHaveValues(controls: PolicyControls): boolean {
  return Boolean(
    (controls.blockedTopics && controls.blockedTopics.length > 0) ||
      (controls.alwaysQueueTopics && controls.alwaysQueueTopics.length > 0) ||
      (controls.blockedActions && controls.blockedActions.length > 0) ||
      controls.executionMode !== undefined ||
      controls.requireGroundingForFacts !== undefined ||
      controls.preferAskWhenUncertain !== undefined ||
      controls.allowAutoSend !== undefined ||
      (controls.notesForAgent && controls.notesForAgent.length > 0)
  );
}

export function normalizeScopedPolicyRules(input: unknown): ScopedPolicyRule[] {
  if (!Array.isArray(input)) {
    return [];
  }

  return input
    .map((item, index): ScopedPolicyRule | undefined => {
      const record = item && typeof item === 'object' ? item as Record<string, unknown> : undefined;
      if (!record) return undefined;

      const matchRecord = record.match && typeof record.match === 'object'
        ? record.match as Record<string, unknown>
        : {};
      const controls = normalizeControls(record.controls);
      if (!controlsHaveValues(controls)) {
        return undefined;
      }

      const intents = listFromUnknown(matchRecord.intents)
        .filter((entry): entry is ContinuityCase => INTENTS.includes(entry as ContinuityCase));
      const actionTypes = listFromUnknown(matchRecord.actionTypes)
        .filter((entry): entry is ContinuityActionType => ACTIONS.includes(entry as ContinuityActionType));

      return {
        id: typeof record.id === 'string' && record.id.trim()
          ? record.id.trim()
          : `rule-${index + 1}`,
        name: typeof record.name === 'string' && record.name.trim()
          ? record.name.trim()
          : `Rule ${index + 1}`,
        match: {
          channelIds: unique(listFromUnknown(matchRecord.channelIds)),
          intents: [...new Set(intents)],
          actionTypes: [...new Set(actionTypes)]
        },
        controls: {
          blockedTopics: unique(controls.blockedTopics ?? []),
          alwaysQueueTopics: unique(controls.alwaysQueueTopics ?? []),
          blockedActions: [...new Set(controls.blockedActions ?? [])],
          executionMode: controls.executionMode,
          requireGroundingForFacts: controls.requireGroundingForFacts,
          preferAskWhenUncertain: controls.preferAskWhenUncertain,
          allowAutoSend: controls.allowAutoSend,
          notesForAgent: unique(controls.notesForAgent ?? [])
        }
      };
    })
    .filter((rule): rule is ScopedPolicyRule => Boolean(rule));
}

export function resolveEffectivePolicy(input: {
  mode: SessionMode;
  executionMode?: PolicyExecutionMode;
  baseProfile?: PolicyProfile;
  overrideRaw?: string;
  scopedRules?: unknown;
}): { profile: PolicyProfile; compiled: CompiledPolicy; warnings: string[] } {
  const profile = input.baseProfile ?? builtinPolicyProfile(input.mode);
  const { patch, warnings } = compilePolicyOverride(input.overrideRaw ?? '');
  const scopedRules = normalizeScopedPolicyRules(input.scopedRules ?? profile.compiled.rules ?? []);
  const merged = mergeCompiledPolicy(profile.compiled, patch);
  const executionMode = input.executionMode ?? merged.executionMode ?? policyExecutionModeFromSessionMode(input.mode);
  return {
    profile,
    compiled: normalizeCompiledPolicy({
      ...merged,
      executionMode,
      allowAutoSend: executionMode === 'auto_send_low_risk',
      rules: scopedRules
    }),
    warnings
  };
}

export function buildUserPolicyProfile(input: {
  mode: SessionMode;
  profileName?: string;
  overrideRaw?: string;
  scopedRules?: unknown;
  compiled: CompiledPolicy;
  source: UserPolicyProfile['source'];
}): UserPolicyProfile {
  return {
    profileName: input.profileName,
    overrideRaw: input.overrideRaw?.trim() || undefined,
    raw: input.overrideRaw?.trim() || '',
    compiled: normalizeCompiledPolicy({
      ...input.compiled,
      rules: normalizeScopedPolicyRules(input.scopedRules ?? input.compiled.rules ?? [])
    }),
    compiledAt: new Date().toISOString(),
    source: input.source,
    version: 2
  };
}
