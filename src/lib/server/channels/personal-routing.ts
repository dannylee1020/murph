import { getStore } from '#lib/server/persistence/store';
import { getRuntimeEnv } from '#lib/server/util/env';
import { mergedSetupDefaults, setupOwnerForWorkspace } from '#lib/server/setup/owner-identity';
import type { SetupOwnerIdentity } from '#lib/server/setup/owner-identity';
import type { ChannelProvider, Workspace } from '#lib/types';

export type PersonalDirectIgnoredReason =
  | 'personal_mode_disabled'
  | 'personal_workspace_required'
  | 'personal_owner_required'
  | 'personal_owner_mismatch';

export type PersonalDirectTarget =
  | {
      ok: true;
      workspace: Workspace;
      ownerUserId: string;
      ownerDisplayName?: string;
    }
  | {
      ok: false;
      ignoredReason: PersonalDirectIgnoredReason;
    };

export function resolvePersonalDirectTarget(provider: ChannelProvider, actorUserId: string | undefined): PersonalDirectTarget {
  if (getRuntimeEnv().productMode !== 'personal') {
    return { ok: false, ignoredReason: 'personal_mode_disabled' };
  }
  if (!actorUserId) {
    return { ok: false, ignoredReason: 'personal_owner_required' };
  }

  const store = getStore();
  const defaults = mergedSetupDefaults();
  const providerWorkspaces = store.listWorkspaces().filter((workspace) => workspace.provider === provider);
  const ownerTargets = providerWorkspaces
    .map((workspace) => ({ workspace, owner: setupOwnerForWorkspace(workspace, defaults) }))
    .filter((entry): entry is { workspace: Workspace; owner: SetupOwnerIdentity } =>
      Boolean(entry.owner?.ownerUserId)
    );

  if (ownerTargets.length === 0) {
    return { ok: false, ignoredReason: 'personal_owner_required' };
  }

  const matchingOwnerTargets = ownerTargets.filter((entry) => entry.owner.ownerUserId === actorUserId);
  if (matchingOwnerTargets.length === 1) {
    const target = matchingOwnerTargets[0];
    return {
      ok: true,
      workspace: target.workspace,
      ownerUserId: target.owner.ownerUserId,
      ownerDisplayName: target.owner.ownerDisplayName
    };
  }

  return {
    ok: false,
    ignoredReason: matchingOwnerTargets.length > 1 ? 'personal_workspace_required' : 'personal_owner_mismatch'
  };
}
