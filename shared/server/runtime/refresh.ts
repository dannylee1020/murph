import { createHash } from 'node:crypto';
import { emitControlPlaneEvent } from '#shared/server/runtime/control-plane';
import { reconcileIntegrationCapabilitiesForWorkspace } from '#shared/server/integrations/capabilities';
import { listIntegrations } from '#shared/server/integrations/registry';
import { listScopedPluginStatuses } from '#shared/server/plugins/loader';
import { loadPolicyProfiles, normalizePolicyProfileName } from '#shared/server/policies/loader';
import { loadSkills } from '#shared/server/skills/loader';
import { getStore } from '#shared/server/persistence/store';
import { readMurphConfig } from '#shared/server/setup/config-file';
import { syncConfigScheduleToSetupOwners } from '#shared/server/setup/config-schedule';
import { getRuntimeEnv } from '#shared/server/util/env';
import {
  buildUserPolicyProfile,
  builtinPolicyProfile,
  resolveEffectivePolicy
} from '#shared/server/runtime/policy-compiler';
import { resolveSubscriberPolicy } from '#shared/server/runtime/subscriber-policy';
import type {
  AutopilotSession,
  PolicyExecutionMode,
  PolicyProfile,
  SessionMode,
  UserPolicyProfile,
  Workspace
} from '#shared/types';

type RefreshReason =
  | 'before_agent_run'
  | 'after_agent_run'
  | 'policy_config_updated'
  | 'setup_defaults_updated'
  | 'setup_config_updated'
  | 'integration_updated'
  | 'workspace_capabilities_updated'
  | 'plugin_reload'
  | 'channel_setup_updated'
  | 'provider_config_updated'
  | 'subscription_policy_updated';

type RuntimeRevision = {
  policy: string;
  setup: string;
  workspaceCapabilities: string;
  integrations: string;
  plugins: string;
  skills: string;
  provider: string;
};

type RuntimeRefreshResult = {
  refreshed: boolean;
  pending: boolean;
  changedSurfaces: string[];
  workspaceIds: string[];
  sessionsUpdated: number;
};

const runTails = new Map<string, Promise<void>>();
const activeRunLocks = new Set<string>();

function stable(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stable);
  }
  if (value && typeof value === 'object') {
    return Object.keys(value as Record<string, unknown>)
      .sort()
      .reduce<Record<string, unknown>>((acc, key) => {
        acc[key] = stable((value as Record<string, unknown>)[key]);
        return acc;
      }, {});
  }
  return value;
}

function stableJson(value: unknown): string {
  return JSON.stringify(stable(value));
}

function hash(value: unknown): string {
  return createHash('sha256').update(stableJson(value)).digest('hex');
}

function parseRevision(value?: string): RuntimeRevision | undefined {
  if (!value) return undefined;
  try {
    return JSON.parse(value) as RuntimeRevision;
  } catch {
    return undefined;
  }
}

function changedSurfaces(previous: RuntimeRevision | undefined, current: RuntimeRevision): string[] {
  if (!previous) {
    return Object.keys(current);
  }
  return (Object.keys(current) as Array<keyof RuntimeRevision>).filter((key) => previous[key] !== current[key]);
}

function sessionModeFromPolicyMode(mode: PolicyExecutionMode): SessionMode {
  return mode;
}

function configuredChannelScope(workspace: Workspace): string[] {
  const setup = getStore().getAppSettings().setupDefaults;
  const workspaceDefaults = setup?.workspaceChannels?.find((entry) => entry.workspaceId === workspace.id);
  if (workspaceDefaults) {
    return workspaceDefaults.channelScopeMode === 'all_accessible'
      ? []
      : workspaceDefaults.selectedChannels.map((channel) => channel.id);
  }

  const isDefaultWorkspace =
    setup?.workspaceId === workspace.id ||
    (!setup?.workspaceId && setup?.channelProvider === workspace.provider);
  if (!isDefaultWorkspace) {
    return [];
  }

  return setup?.channelScopeMode === 'all_accessible'
    ? []
    : (setup?.selectedChannels ?? []).map((channel) => channel.id);
}

async function currentPolicyProfile(): Promise<{
  selectedProfile: PolicyProfile;
  mode: SessionMode;
  executionMode: PolicyExecutionMode;
  userPolicy: UserPolicyProfile;
}> {
  const store = getStore();
  const profiles = await loadPolicyProfiles();
  const config = readMurphConfig();
  const selectedName = normalizePolicyProfileName(config.policy?.profile || store.getAppSettings().policyProfileName);
  const selectedProfile =
    (selectedName ? profiles.find((profile) => profile.name === selectedName) : undefined) ??
    builtinPolicyProfile('manual_review');
  const executionMode = config.policy?.mode ?? selectedProfile.compiled.executionMode;
  const mode = sessionModeFromPolicyMode(executionMode);
  const effective = resolveEffectivePolicy({
    mode,
    executionMode,
    baseProfile: selectedProfile
  });
  const userPolicy = buildUserPolicyProfile({
    mode,
    profileName: selectedProfile.source === 'builtin' ? undefined : selectedProfile.name,
    compiled: effective.compiled,
    source: selectedProfile.source === 'builtin' ? 'default' : 'profile'
  });

  return { selectedProfile, mode, executionMode, userPolicy };
}

async function computeRevision(workspace: Workspace): Promise<{
  revision: RuntimeRevision;
  channelScope: string[];
}> {
  const store = getStore();
  const workspaceMemory = store.getOrCreateWorkspaceMemory(workspace.id);
  const policy = await currentPolicyProfile();
  const profilesByName = new Map((await loadPolicyProfiles()).map((profile) => [profile.name, profile]));
  const channelScope = configuredChannelScope(workspace);
  const env = getRuntimeEnv();
  const skills = await loadSkills();
  const connections = store.listIntegrationConnections(workspace.id);
  const revision: RuntimeRevision = {
    policy: hash({
      profileName: policy.userPolicy.profileName,
      mode: policy.mode,
      compiled: policy.userPolicy.compiled,
      subscriptions: store.listWorkspaceSubscriptions(workspace.id).map((subscription) => ({
        id: subscription.id,
        externalUserId: subscription.externalUserId,
        policyProfileName: subscription.policyProfileName,
        policyMode: subscription.policyMode,
        policyCompiled: subscription.policyProfileName
          ? profilesByName.get(normalizePolicyProfileName(subscription.policyProfileName) ?? '')?.compiled
          : undefined
      }))
    }),
    setup: hash({
      ownerUserId: getStore().getAppSettings().setupDefaults?.workspaceOwners?.find((owner) => owner.workspaceId === workspace.id)?.ownerUserId,
      channelScope
    }),
    workspaceCapabilities: hash({
      enabledOptionalTools: workspaceMemory.enabledOptionalTools,
      enabledContextSources: workspaceMemory.enabledContextSources,
      enabledPlugins: workspaceMemory.enabledPlugins
    }),
    integrations: hash({
      definitions: listIntegrations({ distribution: env.distribution }).map((integration) => ({
        provider: integration.provider,
        tools: integration.tools,
        contextSources: integration.contextSources
      })),
      connections: connections.map((connection) => ({
        provider: connection.provider,
        credentialKind: connection.credentialKind,
        status: connection.status,
        metadata: connection.metadata,
        errorMessage: connection.errorMessage
      }))
    }),
    plugins: hash(listScopedPluginStatuses().map((plugin) => ({
      id: plugin.id,
      status: plugin.status,
      capabilities: plugin.capabilities
    }))),
    skills: hash(skills),
    provider: hash({
      defaultProvider: env.defaultProvider,
      defaultModel: env.defaultModel,
      policyProvider: env.policyProvider,
      policyModel: env.policyModel
    })
  };

  return { revision, channelScope };
}

function scopeForWorkspace(workspaceId: string): string {
  return `workspace:${workspaceId}`;
}

function targetWorkspaces(workspaceIds?: string[]): Workspace[] {
  const store = getStore();
  const all = store.listWorkspaces();
  if (!workspaceIds?.length) {
    return all;
  }
  const targets = new Set(workspaceIds);
  return all.filter((workspace) => targets.has(workspace.id));
}

function isAnyRunActive(workspaceIds: string[]): boolean {
  return workspaceIds.some((workspaceId) => activeRunLocks.has(workspaceId));
}

export async function withRuntimeRunLock<T>(workspaceId: string, fn: () => Promise<T>): Promise<T> {
  const previous = runTails.get(workspaceId) ?? Promise.resolve();
  let release!: () => void;
  const current = previous.then(() => new Promise<void>((resolve) => {
    release = resolve;
  }));
  runTails.set(workspaceId, current);

  await previous;
  activeRunLocks.add(workspaceId);
  try {
    return await fn();
  } finally {
    activeRunLocks.delete(workspaceId);
    release();
    if (runTails.get(workspaceId) === current) {
      runTails.delete(workspaceId);
    }
  }
}

export function markRefreshPending(input: { reason: RefreshReason | string; workspaceIds?: string[] }): void {
  const store = getStore();
  const workspaces = targetWorkspaces(input.workspaceIds);
  if (workspaces.length === 0) {
    store.markRuntimeRefreshPending('global', input.reason);
    return;
  }
  for (const workspace of workspaces) {
    store.markRuntimeRefreshPending(scopeForWorkspace(workspace.id), input.reason);
  }
}

export async function refreshRuntimeState(input: {
  reason: RefreshReason | string;
  workspaceIds?: string[];
  force?: boolean;
  deferIfRunActive?: boolean;
}): Promise<RuntimeRefreshResult> {
  const store = getStore();
  syncConfigScheduleToSetupOwners();
  const workspaces = targetWorkspaces(input.workspaceIds);
  const workspaceIds = workspaces.map((workspace) => workspace.id);

  if (input.deferIfRunActive && isAnyRunActive(workspaceIds)) {
    markRefreshPending({ reason: input.reason, workspaceIds });
    return { refreshed: false, pending: true, changedSurfaces: [], workspaceIds, sessionsUpdated: 0 };
  }

  let sessionsUpdated = 0;
  const allChangedSurfaces = new Set<string>();

  for (const workspace of workspaces) {
    reconcileIntegrationCapabilitiesForWorkspace(workspace.id);
    const scopeKey = scopeForWorkspace(workspace.id);
    const state = store.getRuntimeRefreshState(scopeKey);
    const { revision, channelScope } = await computeRevision(workspace);
    const revisionJson = stableJson(revision);
    const storedRevision = parseRevision(state?.lastRevisionJson);
    const changed = changedSurfaces(storedRevision, revision);
    const activeSessions = store.listActiveSessions(workspace.id);
    const staleSessions = activeSessions.filter((session) => session.runtimeRevisionJson !== revisionJson);

    if (!input.force && !state?.pending && changed.length === 0 && staleSessions.length === 0) {
      continue;
    }

    for (const surface of changed) {
      allChangedSurfaces.add(surface);
    }

    for (const session of staleSessions) {
      const patched = await patchSession(session, {
        session,
        revisionJson,
        channelScope,
        refreshedAt: new Date().toISOString()
      });
      if (patched) {
        sessionsUpdated += 1;
      }
    }

    store.setRuntimeRefreshState(scopeKey, {
      pending: false,
      pendingReasons: [],
      lastRevisionJson: revisionJson
    });
  }

  const result = {
    refreshed: sessionsUpdated > 0 || allChangedSurfaces.size > 0,
    pending: false,
    changedSurfaces: [...allChangedSurfaces],
    workspaceIds,
    sessionsUpdated
  };

  if (result.refreshed) {
    emitControlPlaneEvent({
      type: 'runtime.state.refreshed',
      reason: input.reason,
      changedSurfaces: result.changedSurfaces,
      workspaceIds,
      sessionsUpdated,
      pending: false
    });
  }

  return result;
}

async function patchSession(
  existingSession: AutopilotSession,
  input: {
    session: AutopilotSession;
    revisionJson: string;
    refreshedAt: string;
    channelScope: string[];
  }
): Promise<AutopilotSession | undefined> {
  const store = getStore();
  const policy = input.session.policyBinding === 'config'
    ? await resolveSubscriberPolicy({
        workspaceId: input.session.workspaceId,
        ownerUserId: input.session.ownerUserId
      })
    : undefined;
  return store.patchSessionRefresh(existingSession.id, {
    ...(policy
      ? {
          mode: policy.mode,
          policyProfileName: policy.userPolicy.profileName,
          policyOverrideRaw: policy.userPolicy.overrideRaw,
          policy: policy.userPolicy
        }
      : {}),
    ...(input.session.channelScopeBinding === 'setup_defaults'
      ? { channelScope: input.channelScope }
      : {}),
    runtimeRevisionJson: input.revisionJson,
    lastRuntimeRefreshAt: input.refreshedAt
  });
}
