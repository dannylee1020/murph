import { loadPolicyProfiles, normalizePolicyProfileName } from '#app/server/policies/loader';
import { getStore } from '#app/server/persistence/store';
import { readMurphConfig } from '#app/server/setup/config-file';
import {
  buildUserPolicyProfile,
  builtinPolicyProfile,
  normalizeCompiledPolicy,
  resolveEffectivePolicy
} from '#app/server/runtime/policy-compiler';
import type {
  CompiledPolicy,
  PolicyControls,
  PolicyExecutionMode,
  PolicyProfile,
  ScopedPolicyRule,
  SessionMode,
  UserPolicyProfile,
  WorkspaceSubscription
} from '#app/types';

export interface SubscriberPolicyResolution {
  mode: SessionMode;
  executionMode: PolicyExecutionMode;
  profile: PolicyProfile;
  userPolicy: UserPolicyProfile;
  subscription?: WorkspaceSubscription;
}

function sessionModeFromPolicyMode(mode: PolicyExecutionMode): SessionMode {
  return mode;
}

function resolveSessionMode(inputMode: SessionMode | undefined, policyMode: PolicyExecutionMode): SessionMode {
  if (!inputMode) return sessionModeFromPolicyMode(policyMode);
  if (inputMode === 'dry_run') return 'dry_run';
  if (inputMode === 'manual_review') return 'manual_review';
  return policyMode === 'auto_send_low_risk' ? 'auto_send_low_risk' : 'manual_review';
}

function profileByName(profiles: PolicyProfile[], profileName: string | undefined): PolicyProfile | undefined {
  const normalized = normalizePolicyProfileName(profileName);
  return normalized ? profiles.find((profile) => profile.name === normalized) : undefined;
}

function clampExecutionMode(
  subscriberMode: PolicyExecutionMode,
  hostMode: PolicyExecutionMode
): PolicyExecutionMode {
  return hostMode === 'manual_review' ? 'manual_review' : subscriberMode;
}

function clampRuleControlsToExecutionFloor(
  controls: PolicyControls,
  executionMode: PolicyExecutionMode
): PolicyControls {
  if (executionMode === 'auto_send_low_risk') {
    return controls;
  }
  return {
    ...controls,
    executionMode: controls.executionMode === 'auto_send_low_risk'
      ? 'manual_review'
      : controls.executionMode,
    allowAutoSend: controls.allowAutoSend === true ? false : controls.allowAutoSend
  };
}

function clampRulesToExecutionFloor(
  rules: ScopedPolicyRule[] | undefined,
  executionMode: PolicyExecutionMode
): ScopedPolicyRule[] {
  return (rules ?? []).map((rule) => ({
    ...rule,
    controls: clampRuleControlsToExecutionFloor(rule.controls, executionMode)
  }));
}

function mergeHostSafetyFloor(subscriber: CompiledPolicy, host: CompiledPolicy, executionMode: PolicyExecutionMode): CompiledPolicy {
  return normalizeCompiledPolicy({
    blockedTopics: [...host.blockedTopics, ...subscriber.blockedTopics],
    alwaysQueueTopics: [...host.alwaysQueueTopics, ...subscriber.alwaysQueueTopics],
    executionMode,
    preferAskWhenUncertain: host.preferAskWhenUncertain || subscriber.preferAskWhenUncertain,
    allowAutoSend: executionMode === 'auto_send_low_risk',
    notesForAgent: [...host.notesForAgent, ...subscriber.notesForAgent],
    rules: clampRulesToExecutionFloor([...(host.rules ?? []), ...(subscriber.rules ?? [])], executionMode)
  });
}

export async function resolveSubscriberPolicy(input: {
  workspaceId: string;
  ownerUserId: string;
  requestedMode?: SessionMode;
}): Promise<SubscriberPolicyResolution> {
  const store = getStore();
  const profiles = await loadPolicyProfiles();
  const config = readMurphConfig();
  const hostProfile =
    profileByName(profiles, config.policy?.profile || store.getAppSettings().policyProfileName) ??
    builtinPolicyProfile('manual_review');
  const hostExecutionMode = hostProfile.compiled.executionMode;
  const hostEffective = resolveEffectivePolicy({
    mode: sessionModeFromPolicyMode(hostExecutionMode),
    executionMode: hostExecutionMode,
    baseProfile: hostProfile
  });

  const subscription = store.getWorkspaceSubscription(input.workspaceId, input.ownerUserId);
  const subscriberProfile =
    profileByName(profiles, subscription?.policyProfileName) ??
    hostProfile;
  const subscriberExecutionMode = subscriberProfile.compiled.executionMode;
  const executionMode = clampExecutionMode(subscriberExecutionMode, hostExecutionMode);
  const mode = resolveSessionMode(input.requestedMode, executionMode);
  const subscriberEffective = resolveEffectivePolicy({
    mode,
    executionMode,
    baseProfile: subscriberProfile
  });
  const compiled = mergeHostSafetyFloor(
    subscriberEffective.compiled,
    hostEffective.compiled,
    executionMode
  );
  const userPolicy = buildUserPolicyProfile({
    mode,
    profileName: subscriberProfile.source === 'builtin' ? undefined : subscriberProfile.name,
    compiled,
    source: subscriberProfile.source === 'builtin' ? 'default' : 'profile'
  });

  return {
    mode,
    executionMode,
    profile: subscriberProfile,
    userPolicy,
    subscription
  };
}
