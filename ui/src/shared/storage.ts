import type { SetupDefaultsPayload } from './types';

const HOME_WORKSPACE_ENABLED_KEY_PREFIX = 'murph_home_workspace_enabled';
const HOME_CHANNEL_SCOPE_MODE_KEY_PREFIX = 'murph_home_channel_scope_mode';
const HOME_SELECTED_CHANNELS_KEY_PREFIX = 'murph_home_selected_channels';

export function getCurrentUserId(): string {
    return localStorage.getItem('murph_current_user_id') ?? '';
}

export function getCurrentUserName(): string {
    return localStorage.getItem('murph_current_user_name') ?? '';
}

export function setCurrentUser(id: string, name: string): void {
    localStorage.setItem('murph_current_user_id', id);
    localStorage.setItem('murph_current_user_name', name);
}

export function getSelectedChannels(): Array<{ id: string; displayName: string }> {
    const raw = localStorage.getItem('murph_selected_channels');
    if (!raw) return [];
    try {
        const parsed = JSON.parse(raw) as Array<{
            id: string;
            displayName: string;
        }>;
        return parsed.filter(
            (entry) =>
                entry &&
                typeof entry.id === 'string' &&
                typeof entry.displayName === 'string',
        );
    } catch {
        return [];
    }
}

export function setSelectedChannels(
    channels: Array<{ id: string; displayName: string }>,
): void {
    localStorage.setItem('murph_selected_channels', JSON.stringify(channels));
}


export function storageKey(prefix: string, workspaceId: string): string {
    return `${prefix}:${workspaceId}`;
}

export function getHomeWorkspaceEnabled(
    workspaceId: string,
    defaultEnabled: boolean,
): boolean {
    const stored = localStorage.getItem(
        storageKey(HOME_WORKSPACE_ENABLED_KEY_PREFIX, workspaceId),
    );
    if (stored === 'true') return true;
    if (stored === 'false') return false;
    return defaultEnabled;
}

export function setHomeWorkspaceEnabled(workspaceId: string, enabled: boolean): void {
    localStorage.setItem(
        storageKey(HOME_WORKSPACE_ENABLED_KEY_PREFIX, workspaceId),
        String(enabled),
    );
}

export function getHomeChannelMode(
    workspaceId: string,
    defaults?: SetupDefaultsPayload['defaults'],
): 'selected' | 'all_accessible' {
    const stored = localStorage.getItem(
        storageKey(HOME_CHANNEL_SCOPE_MODE_KEY_PREFIX, workspaceId),
    );
    if (stored === 'selected' || stored === 'all_accessible') {
        return stored;
    }
    const workspaceChannels = defaults?.workspaceChannels?.find(
        (entry) => entry.workspaceId === workspaceId,
    );
    if (workspaceChannels) return workspaceChannels.channelScopeMode;
    return defaults?.channelScopeMode === 'all_accessible'
        ? 'all_accessible'
        : 'selected';
}

export function getHomeSelectedChannels(
    workspaceId: string,
    defaults?: SetupDefaultsPayload['defaults'],
): Array<{ id: string; displayName: string }> {
    const raw = localStorage.getItem(
        storageKey(HOME_SELECTED_CHANNELS_KEY_PREFIX, workspaceId),
    );
    if (raw) {
        try {
            const parsed = JSON.parse(raw) as Array<{
                id: string;
                displayName: string;
            }>;
            return parsed.filter(
                (entry) =>
                    entry &&
                    typeof entry.id === 'string' &&
                    typeof entry.displayName === 'string',
            );
        } catch {}
    }
    const workspaceChannels = defaults?.workspaceChannels?.find(
        (entry) => entry.workspaceId === workspaceId,
    );
    if (workspaceChannels?.channelScopeMode === 'selected') {
        return workspaceChannels.selectedChannels;
    }
    return defaults?.channelScopeMode === 'selected'
        ? (defaults.selectedChannels ?? [])
        : [];
}

export function setHomeChannelSelection(
    workspaceId: string,
    mode: 'selected' | 'all_accessible',
    channels: Array<{ id: string; displayName: string }>,
): void {
    localStorage.setItem(
        storageKey(HOME_CHANNEL_SCOPE_MODE_KEY_PREFIX, workspaceId),
        mode,
    );
    localStorage.setItem(
        storageKey(HOME_SELECTED_CHANNELS_KEY_PREFIX, workspaceId),
        JSON.stringify(channels),
    );
}
