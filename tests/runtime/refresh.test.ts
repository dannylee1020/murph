import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const originalCwd = process.cwd();

function writePolicy(root: string, name: string, body: string): void {
  const policies = join(root, 'policies');
  mkdirSync(policies, { recursive: true });
  writeFileSync(join(policies, `${name}.md`), body);
}

function manualPolicy(name = 'engineering'): string {
  return [
    `name: ${name}`,
    'description: Manual policy',
    'blockedTopics:',
    'alwaysQueueTopics:',
    'blockedActions:',
    'mode: manual_review',
    'allowAutoSend: no',
    'requireGroundingForFacts: yes',
    'preferAskWhenUncertain: yes',
    'notes: queue by default',
    '---',
    'Queue replies for operator review.'
  ].join('\n');
}

function autoPolicy(name = 'engineering-auto'): string {
  return [
    `name: ${name}`,
    'description: Auto-send low risk policy',
    'blockedTopics:',
    'alwaysQueueTopics:',
    'blockedActions:',
    'mode: auto_send_low_risk',
    'allowAutoSend: yes',
    'requireGroundingForFacts: yes',
    'preferAskWhenUncertain: yes',
    'notes: auto-send low-risk engineering replies',
    '---',
    'Auto-send low-risk engineering replies.'
  ].join('\n');
}

async function setup() {
  vi.resetModules();
  const root = mkdtempSync(join(tmpdir(), 'murph-runtime-refresh-'));
  process.chdir(root);
  process.env.MURPH_APP_DIR = root;
  process.env.MURPH_CONFIG_PATH = join(root, 'config.yaml');
  process.env.MURPH_SQLITE_PATH = join(root, 'murph.sqlite');
  process.env.MURPH_MEMORY_PATH = join(root, 'memory');
  process.env.MURPH_ENCRYPTION_KEY = 'test-key';
  writePolicy(root, 'engineering', manualPolicy('engineering'));
  writePolicy(root, 'engineering-auto', autoPolicy('engineering-auto'));

  const { getStore } = await import('../../src/lib/server/persistence/store');
  const { updateMurphPolicyConfig } = await import('../../src/lib/server/setup/config-file');
  const { refreshRuntimeState, withRuntimeRunLock } = await import('../../src/lib/server/runtime/refresh');
  const store = getStore();
  const workspace = store.saveInstall({
    provider: 'slack',
    externalWorkspaceId: 'T1',
    name: 'Test Workspace',
    botUserId: 'UBOT'
  });
  store.upsertUser({
    workspaceId: workspace.id,
    externalUserId: 'UOWNER',
    displayName: 'Owner'
  });

  return { store, workspace, updateMurphPolicyConfig, refreshRuntimeState, withRuntimeRunLock };
}

describe('runtime refresh', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    process.chdir(originalCwd);
    delete process.env.MURPH_APP_DIR;
    delete process.env.MURPH_CONFIG_PATH;
    delete process.env.MURPH_SQLITE_PATH;
    delete process.env.MURPH_MEMORY_PATH;
    delete process.env.MURPH_ENCRYPTION_KEY;
  });

  it('patches config-bound active sessions when policy config changes', async () => {
    const { store, workspace, updateMurphPolicyConfig, refreshRuntimeState } = await setup();
    updateMurphPolicyConfig({ profileName: 'engineering', mode: 'manual_review' });
    const session = store.createSession({
      workspaceId: workspace.id,
      ownerUserId: 'UOWNER',
      title: 'Coverage',
      mode: 'manual_review',
      channelScope: ['C1'],
      policyBinding: 'config',
      channelScopeBinding: 'explicit',
      endsAt: new Date(Date.now() + 60_000).toISOString()
    });

    updateMurphPolicyConfig({ profileName: 'engineering-auto', mode: 'auto_send_low_risk' });
    await refreshRuntimeState({ reason: 'policy_config_updated', workspaceIds: [workspace.id], force: true });

    const refreshed = store.getSessionById(session.id)!;
    expect(refreshed.mode).toBe('auto_send_low_risk');
    expect(refreshed.policyProfileName).toBe('engineering-auto');
    expect(refreshed.policy?.compiled.allowAutoSend).toBe(true);
    expect(refreshed.runtimeRevisionJson).toBeTruthy();
  });

  it('does not upgrade explicit manual sessions when policy config changes', async () => {
    const { store, workspace, updateMurphPolicyConfig, refreshRuntimeState } = await setup();
    const session = store.createSession({
      workspaceId: workspace.id,
      ownerUserId: 'UOWNER',
      title: 'Manual review',
      mode: 'manual_review',
      channelScope: ['C1'],
      policyBinding: 'explicit',
      channelScopeBinding: 'explicit',
      endsAt: new Date(Date.now() + 60_000).toISOString()
    });

    updateMurphPolicyConfig({ profileName: 'engineering-auto', mode: 'auto_send_low_risk' });
    await refreshRuntimeState({ reason: 'policy_config_updated', workspaceIds: [workspace.id], force: true });

    const refreshed = store.getSessionById(session.id)!;
    expect(refreshed.mode).toBe('manual_review');
    expect(refreshed.policyProfileName).toBeUndefined();
    expect(refreshed.runtimeRevisionJson).toBeTruthy();
  });

  it('marks refresh pending when a run lock is active and drains on the next boundary', async () => {
    const { store, workspace, refreshRuntimeState, withRuntimeRunLock } = await setup();

    await withRuntimeRunLock(workspace.id, async () => {
      const result = await refreshRuntimeState({
        reason: 'policy_config_updated',
        workspaceIds: [workspace.id],
        deferIfRunActive: true
      });
      expect(result.pending).toBe(true);
    });

    expect(store.getRuntimeRefreshState(`workspace:${workspace.id}`)?.pending).toBe(true);
    await refreshRuntimeState({ reason: 'before_agent_run', workspaceIds: [workspace.id] });
    expect(store.getRuntimeRefreshState(`workspace:${workspace.id}`)?.pending).toBe(false);
  });
});
