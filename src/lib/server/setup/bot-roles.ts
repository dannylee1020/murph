import type { BotInstallation, BotRole, SetupDefaults } from '#lib/types';

export const SETUP_BOT_ROLES: BotRole[] = ['channel', 'personal'];

export interface SetupRoleStatus {
  selected: boolean;
  ready: boolean;
  providers: Array<{
    provider: string;
    ready: boolean;
    installations: BotInstallation[];
    reason?: string;
  }>;
}

export function normalizeSetupBotRoles(value: unknown): BotRole[] {
  if (!Array.isArray(value)) return ['channel'];
  const roles = value
    .filter((entry): entry is BotRole => entry === 'channel' || entry === 'personal');
  const unique = Array.from(new Set(roles));
  return unique.length > 0 ? unique : ['channel'];
}

export function selectedSetupBotRoles(defaults: SetupDefaults | undefined): BotRole[] {
  return normalizeSetupBotRoles(defaults?.botRoles);
}

export function setupRolesCsv(roles: BotRole[]): string {
  return normalizeSetupBotRoles(roles).join(',');
}

export function workspaceChannelsConfigured(defaults: SetupDefaults | undefined): boolean {
  if (!defaults) return false;
  if (defaults.workspaceChannels?.some((entry) => (
    entry.channelScopeMode === 'all_accessible' || entry.selectedChannels.length > 0
  ))) {
    return true;
  }
  return defaults.channelScopeMode === 'all_accessible' || Boolean(defaults.selectedChannels?.length);
}

export function buildSetupRoleStatus(input: {
  defaults?: SetupDefaults;
  botInstallations: BotInstallation[];
  userConfigured: boolean;
}): Record<BotRole, SetupRoleStatus> {
  const selected = new Set(selectedSetupBotRoles(input.defaults));
  const byRole = (role: BotRole) => input.botInstallations.filter((installation) => (
    installation.role === role && installation.status === 'active'
  ));
  const providerRows = (role: BotRole, ready: (installation: BotInstallation) => boolean) => {
    const providerMap = new Map<string, BotInstallation[]>();
    for (const installation of byRole(role)) {
      providerMap.set(installation.provider, [
        ...(providerMap.get(installation.provider) ?? []),
        installation
      ]);
    }
    return Array.from(providerMap.entries()).map(([provider, installations]) => ({
      provider,
      installations,
      ready: installations.some(ready),
      reason: installations.some(ready) ? undefined : role === 'personal' ? 'represented_owner_required' : 'channel_defaults_required'
    }));
  };

  const channelProviders = providerRows('channel', () => (
    input.userConfigured && workspaceChannelsConfigured(input.defaults)
  ));
  const personalProviders = providerRows('personal', (installation) => Boolean(installation.representedUserId));

  return {
    channel: {
      selected: selected.has('channel'),
      ready: channelProviders.some((provider) => provider.ready),
      providers: channelProviders
    },
    personal: {
      selected: selected.has('personal'),
      ready: personalProviders.some((provider) => provider.ready),
      providers: personalProviders
    }
  };
}

export function selectedSetupRolesReady(status: Record<BotRole, SetupRoleStatus>): boolean {
  return SETUP_BOT_ROLES
    .filter((role) => status[role].selected)
    .every((role) => status[role].ready);
}
