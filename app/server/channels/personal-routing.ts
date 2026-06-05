import { getStore } from '#app/server/persistence/store';
import { mergedSetupDefaults, setupOwnerForWorkspace } from '#app/server/setup/owner-identity';
import type { SetupOwnerIdentity } from '#app/server/setup/owner-identity';
import type { BotInstallation, ChannelProvider, Workspace } from '#app/types';

export type PersonalDirectIgnoredReason =
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

function currentPersonalAppId(provider: ChannelProvider): string | undefined {
  const store = getStore();
  if (provider === 'slack') {
    const config = store.getBotAppConfig('slack', 'personal');
    return process.env.SLACK_PERSONAL_APP_ID ?? config?.appId;
  }
  if (provider === 'discord') {
    const config = store.getBotAppConfig('discord', 'personal');
    return process.env.DISCORD_PERSONAL_CLIENT_ID ?? config?.clientId ?? config?.appId;
  }
  return undefined;
}

function isCurrentPersonalInstallation(provider: ChannelProvider, installation: BotInstallation | undefined): installation is BotInstallation {
  if (!installation || installation.status !== 'active') return false;
  if (provider !== 'slack' && provider !== 'discord') return true;
  const appId = currentPersonalAppId(provider);
  return Boolean(appId && installation.appId === appId && installation.representedUserId);
}

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
  if (isCurrentPersonalInstallation(provider, botInstallation) && botInstallation.representedUserId) {
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
  const currentWorkspaceIds = new Set(store
    .listBotInstallations({ provider, role: 'personal' })
    .filter((installation) => isCurrentPersonalInstallation(provider, installation))
    .map((installation) => installation.workspaceId));
  const providerWorkspaces = store
    .listWorkspaces()
    .filter((workspace) => workspace.provider === provider && (
      provider !== 'slack' && provider !== 'discord'
        ? true
        : currentWorkspaceIds.has(workspace.id)
    ));
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
