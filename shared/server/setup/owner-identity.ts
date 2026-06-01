import { getStore } from '#shared/server/persistence/store';
import type { SetupDefaults, Workspace } from '#shared/types';

export type SetupOwnerIdentity = {
  workspaceId: string;
  ownerUserId: string;
  ownerDisplayName?: string;
};

export type OwnerIdentityCheck =
  | { ok: true; owner: SetupOwnerIdentity }
  | { ok: false; error: 'owner_identity_required' | 'owner_identity_mismatch'; owner?: SetupOwnerIdentity };

export function providerLocksOwnerIdentity(provider: string): boolean {
  return provider === 'slack' || provider === 'discord';
}

export function mergedSetupDefaults(): SetupDefaults {
  return getStore().getAppSettings().setupDefaults ?? {};
}

export function setupOwnerForWorkspace(
  workspace: Workspace,
  defaults: SetupDefaults = mergedSetupDefaults()
): SetupOwnerIdentity | undefined {
  const workspaceOwner = defaults.workspaceOwners?.find((owner) => owner.workspaceId === workspace.id);
  if (workspaceOwner?.ownerUserId) {
    return {
      workspaceId: workspace.id,
      ownerUserId: workspaceOwner.ownerUserId,
      ownerDisplayName: workspaceOwner.ownerDisplayName
    };
  }

  if (!defaults.ownerUserId) {
    return undefined;
  }

  const workspaces = getStore().listWorkspaces();
  const defaultWorkspaceId = defaults.workspaceId;
  const legacyOwnerApplies = defaultWorkspaceId
    ? defaultWorkspaceId === workspace.id
    : workspaces.length <= 1;

  return legacyOwnerApplies
    ? {
        workspaceId: workspace.id,
        ownerUserId: defaults.ownerUserId,
        ownerDisplayName: defaults.ownerDisplayName
      }
    : undefined;
}

export function requireMatchingSetupOwner(
  workspace: Workspace,
  requestedOwnerUserId: string | undefined,
  defaults: SetupDefaults = mergedSetupDefaults()
): OwnerIdentityCheck {
  const owner = setupOwnerForWorkspace(workspace, defaults);

  if (!providerLocksOwnerIdentity(workspace.provider)) {
    return {
      ok: true,
      owner: {
        workspaceId: workspace.id,
        ownerUserId: requestedOwnerUserId ?? owner?.ownerUserId ?? '',
        ownerDisplayName: owner?.ownerDisplayName
      }
    };
  }

  if (!owner?.ownerUserId) {
    return { ok: false, error: 'owner_identity_required' };
  }

  if (requestedOwnerUserId && requestedOwnerUserId !== owner.ownerUserId) {
    return { ok: false, error: 'owner_identity_mismatch', owner };
  }

  return { ok: true, owner };
}
