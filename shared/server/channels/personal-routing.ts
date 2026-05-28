import { getStore } from '#shared/server/persistence/store';
import { mergedSetupDefaults, setupOwnerForWorkspace } from '#shared/server/setup/owner-identity';
import { readMurphConfig } from '#shared/server/setup/config-file';
import type { SetupOwnerIdentity } from '#shared/server/setup/owner-identity';
import type { ChannelProvider, Workspace } from '#shared/types';

export type PersonalDirectIgnoredReason =
  | 'owner_dm_unsupported'
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

export function resolvePersonalDirectTarget(
  provider: ChannelProvider,
  actorUserId: string | undefined,
  input: { botInstallationId?: string; externalWorkspaceId?: string } = {}
): PersonalDirectTarget {
  if (!actorUserId) {
    return { ok: false, ignoredReason: 'personal_owner_required' };
  }

  const store = getStore();
  const botInstallation = input.botInstallationId
    ? store.getBotInstallationById(input.botInstallationId)
    : input.externalWorkspaceId
      ? store.getBotInstallation(provider, input.externalWorkspaceId, 'personal')
      : undefined;
  const distribution = readMurphConfig().app?.distribution ?? 'team';
  if (botInstallation?.representedUserId) {
    if (botInstallation.representedUserId === actorUserId) {
      if (distribution !== 'personal') {
        return { ok: false, ignoredReason: 'owner_dm_unsupported' };
      }
      const workspace = store.getWorkspaceById(botInstallation.workspaceId);
      if (!workspace) {
        return { ok: false, ignoredReason: 'personal_workspace_required' };
      }
      return {
        ok: true,
        workspace,
        ownerUserId: botInstallation.representedUserId
      };
    }
    if (distribution === 'personal') {
      return { ok: false, ignoredReason: 'personal_owner_mismatch' };
    }
    const workspace = store.getWorkspaceById(botInstallation.workspaceId);
    if (!workspace) {
      return { ok: false, ignoredReason: 'personal_workspace_required' };
    }
    return {
      ok: true,
      workspace,
      ownerUserId: botInstallation.representedUserId
    };
  }

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

  const matchingWorkspaceTargets = input.externalWorkspaceId
    ? ownerTargets.filter((entry) => entry.workspace.externalWorkspaceId === input.externalWorkspaceId)
    : ownerTargets;
  if (matchingWorkspaceTargets.length === 1) {
    const target = matchingWorkspaceTargets[0];
    if (target.owner.ownerUserId === actorUserId) {
      if (distribution !== 'personal') {
        return { ok: false, ignoredReason: 'owner_dm_unsupported' };
      }
    } else if (distribution === 'personal') {
      return { ok: false, ignoredReason: 'personal_owner_mismatch' };
    }
    return {
      ok: true,
      workspace: target.workspace,
      ownerUserId: target.owner.ownerUserId,
      ownerDisplayName: target.owner.ownerDisplayName
    };
  }

  return {
    ok: false,
    ignoredReason: matchingWorkspaceTargets.length > 1 ? 'personal_workspace_required' : 'personal_owner_mismatch'
  };
}
