import type {
    ChannelChoice,
    ChannelWorkspace,
    SetupDefaultsPayload,
    SetupStatusPayload,
} from './types';
import { providerLabel } from './labels';

export function adminChannelWorkspaces(setup: SetupStatusPayload): ChannelWorkspace[] {
    if (setup.channelWorkspaces?.length) {
        return setup.channelWorkspaces;
    }
    return [setup.slack.workspace, setup.discord.workspace].filter(
        (workspace): workspace is ChannelWorkspace => Boolean(workspace),
    );
}

export function workspaceOptionLabel(workspace: ChannelWorkspace): string {
    return `${providerLabel(workspace.provider)} · ${workspace.name}`;
}

export function channelBadge(channel: ChannelChoice): string {
    if (channel.isPrivate) return 'Private';
    if (channel.isMember) return 'Joined';
    return 'Public';
}

export function defaultOwnerForWorkspace(
    workspace: ChannelWorkspace,
    defaultsPayload: SetupDefaultsPayload,
    workspaceCount: number,
): { id: string; name: string } {
    const defaults = defaultsPayload.defaults ?? {};
    const workspaceOwner = defaults.workspaceOwners?.find(
        (owner) => owner.workspaceId === workspace.id,
    );
    if (workspaceOwner?.ownerUserId) {
        return {
            id: workspaceOwner.ownerUserId,
            name: workspaceOwner.ownerDisplayName ?? workspaceOwner.ownerUserId,
        };
    }

    const legacyOwnerApplies = defaults.workspaceId
        ? defaults.workspaceId === workspace.id
        : workspaceCount <= 1;
    if (legacyOwnerApplies && defaults.ownerUserId) {
        return {
            id: defaults.ownerUserId,
            name: defaults.ownerDisplayName ?? defaults.ownerUserId,
        };
    }

    return { id: '', name: '' };
}
