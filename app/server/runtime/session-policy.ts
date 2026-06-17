import { getStore } from '#app/server/persistence/store';
import { loadPolicyProfiles, normalizePolicyProfileName } from '#app/server/policies/loader';
import {
  buildUserPolicyProfile,
  builtinPolicyProfile,
  resolveEffectivePolicy
} from '#app/server/runtime/policy-compiler';
import { readMurphConfig } from '#app/server/setup/config-file';
import type { PolicyExecutionMode, SessionMode } from '#app/types';

export function sessionModeFromPolicyMode(mode: PolicyExecutionMode): SessionMode {
  return mode;
}

export function resolveSessionMode(inputMode: SessionMode | undefined, policyMode: PolicyExecutionMode): SessionMode {
  if (!inputMode) return sessionModeFromPolicyMode(policyMode);
  if (inputMode === 'dry_run') return 'dry_run';
  if (inputMode === 'manual_review') return 'manual_review';
  return policyMode === 'auto_send_low_risk' ? 'auto_send_low_risk' : 'manual_review';
}

export async function resolveSessionPolicy(inputMode?: SessionMode) {
  const store = getStore();
  const settings = store.getAppSettings();
  const configProfileName = readMurphConfig().policy?.profile;
  const selectedName = normalizePolicyProfileName(configProfileName || settings.policyProfileName);
  const profiles = await loadPolicyProfiles();
  const selectedProfile =
    (selectedName ? profiles.find((profile) => profile.name === selectedName) : undefined) ??
    builtinPolicyProfile('manual_review');
  const policyMode = selectedProfile.compiled.executionMode;
  const mode = resolveSessionMode(inputMode, policyMode);
  const effective = resolveEffectivePolicy({
    mode,
    executionMode: policyMode,
    baseProfile: selectedProfile
  });

  return {
    mode,
    policyProfileName: selectedProfile.name,
    policy: buildUserPolicyProfile({
      mode,
      profileName: selectedProfile.name,
      compiled: effective.compiled,
      source: 'profile'
    })
  };
}
