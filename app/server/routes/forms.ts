import { emitControlPlaneEvent } from '#app/server/runtime/control-plane';
import { getStore } from '#app/server/persistence/store';
import { requireMatchingSetupOwner } from '#app/server/setup/owner-identity';
import { readMurphConfig } from '#app/server/setup/config-file';
import { loadPolicyProfiles, normalizePolicyProfileName } from '#app/server/policies/loader';
import { builtinPolicyProfile } from '#app/server/runtime/policy-compiler';
import type { PolicyExecutionMode, SessionMode } from '#app/types';
import { readForm, redirect } from '../http.js';
import { route, type Route } from '../router.js';

function sessionModeFromPolicyMode(mode: PolicyExecutionMode): SessionMode {
  return mode;
}

function resolveSessionMode(inputMode: SessionMode | undefined, policyMode: PolicyExecutionMode): SessionMode {
  if (!inputMode) return sessionModeFromPolicyMode(policyMode);
  if (inputMode === 'dry_run') return 'dry_run';
  if (inputMode === 'manual_review') return 'manual_review';
  return policyMode === 'auto_send_low_risk' ? 'auto_send_low_risk' : 'manual_review';
}

async function selectedPolicyMode(): Promise<PolicyExecutionMode> {
  const store = getStore();
  const config = readMurphConfig();
  const selectedName = normalizePolicyProfileName(config.policy?.profile || store.getAppSettings().policyProfileName);
  const profiles = await loadPolicyProfiles();
  const selectedProfile =
    (selectedName ? profiles.find((profile) => profile.name === selectedName) : undefined) ??
    builtinPolicyProfile('manual_review');
  return selectedProfile.compiled.executionMode;
}

async function createSessionFromInput(input: {
  ownerUserId: string;
  title: string;
  mode?: SessionMode;
  channelScopeRaw: string;
  durationHours: number;
}): Promise<{ ok: true; session: { id: string } } | { ok: false }> {
  const store = getStore();
  const workspace = store.getFirstWorkspace();

  if (!workspace) {
    return { ok: false };
  }

  const ownerCheck = requireMatchingSetupOwner(workspace, input.ownerUserId);
  if (!ownerCheck.ok) {
    return { ok: false };
  }

  store.upsertUser({
    workspaceId: workspace.id,
    externalUserId: input.ownerUserId,
    displayName: input.ownerUserId
  });

  const policyMode = await selectedPolicyMode();
  const mode = resolveSessionMode(input.mode, policyMode);
  const session = store.createSession({
    workspaceId: workspace.id,
    ownerUserId: input.ownerUserId,
    title: input.title,
    mode,
    channelScope: input.channelScopeRaw
      ? input.channelScopeRaw
          .split(',')
          .map((entry) => entry.trim())
          .filter(Boolean)
      : [],
    policyBinding: input.mode ? 'explicit' : 'config',
    channelScopeBinding: input.channelScopeRaw ? 'explicit' : 'setup_defaults',
    endsAt: new Date(Date.now() + input.durationHours * 60 * 60 * 1000).toISOString()
  });
  emitControlPlaneEvent({ type: 'session.updated', session });

  return { ok: true, session };
}

function stopSession(sessionId: string): void {
  const store = getStore();
  const existing = store.getSessionById(sessionId);

  if (!existing) {
    return;
  }

  store.stopSession(sessionId);
  const session = store.getSessionById(sessionId);

  if (session) {
    emitControlPlaneEvent({ type: 'session.updated', session });
    emitControlPlaneEvent({ type: 'briefing.ready', sessionId: session.id });
  }
}

export const formRoutes: Route[] = [
  route('POST', '/api/sessions/start', async ({ req, res }) => {
    const formData = await readForm(req);
    const ownerUserId = String(formData.get('ownerUserId') ?? '').trim();

    if (!ownerUserId) {
      redirect(res, '/?error=owner_required', 303);
      return;
    }

    const response = await createSessionFromInput({
      ownerUserId,
      title: String(formData.get('title') ?? 'Overnight autopilot').trim() || 'Overnight autopilot',
      mode: (String(formData.get('mode') ?? '').trim() || undefined) as SessionMode | undefined,
      channelScopeRaw: String(formData.get('channelScope') ?? '').trim(),
      durationHours: Math.max(1, Number(formData.get('durationHours') ?? 10))
    });

    if (!response.ok) {
      redirect(res, '/settings?error=install_workspace_first', 303);
      return;
    }

    redirect(res, `/?session=${response.session.id}`, 303);
  }),
  route('POST', '/api/sessions/stop', async ({ req, res }) => {
    const formData = await readForm(req);
    const sessionId = String(formData.get('sessionId') ?? '').trim();

    if (sessionId) {
      stopSession(sessionId);
    }

    redirect(res, '/', 303);
  })
];
