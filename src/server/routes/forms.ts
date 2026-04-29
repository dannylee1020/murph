import { emitControlPlaneEvent } from '#lib/server/runtime/control-plane';
import { getStore } from '#lib/server/persistence/store';
import type { SessionMode } from '#lib/types';
import { readForm, redirect } from '../http.js';
import { route, type Route } from '../router.js';

async function createSessionFromInput(input: {
  ownerUserId: string;
  title: string;
  mode: SessionMode;
  channelScopeRaw: string;
  durationHours: number;
}): Promise<{ ok: true; session: { id: string } } | { ok: false }> {
  const store = getStore();
  const workspace = store.getFirstWorkspace();

  if (!workspace) {
    return { ok: false };
  }

  store.upsertUser({
    workspaceId: workspace.id,
    externalUserId: input.ownerUserId,
    displayName: input.ownerUserId
  });

  const session = store.createSession({
    workspaceId: workspace.id,
    ownerUserId: input.ownerUserId,
    title: input.title,
    mode: input.mode,
    channelScope: input.channelScopeRaw
      ? input.channelScopeRaw
          .split(',')
          .map((entry) => entry.trim())
          .filter(Boolean)
      : [],
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
      mode: (String(formData.get('mode') ?? 'manual_review').trim() || 'manual_review') as SessionMode,
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
