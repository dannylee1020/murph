import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AutopilotSession, Workspace } from '../src/lib/types';

interface SlackAdapterTestContext {
  store: Awaited<ReturnType<typeof loadStore>>;
  normalizeSlackEvent: typeof import('../src/lib/server/channels/slack/adapter').normalizeSlackEvent;
  workspace: Workspace;
  session: AutopilotSession;
}

async function loadStore() {
  const { getStore } = await import('../src/lib/server/persistence/store');
  return getStore();
}

async function setup(): Promise<SlackAdapterTestContext> {
  const store = await loadStore();
  const { normalizeSlackEvent } = await import('../src/lib/server/channels/slack/adapter');
  const workspace = store.saveInstall({
    slackTeamId: 'T1',
    name: 'Test Workspace',
    botTokenEncrypted: 'test-token',
    botUserId: 'UTZBOT'
  });

  store.upsertUser({
    workspaceId: workspace.id,
    slackUserId: 'UOWNER',
    displayName: 'Owner'
  });

  const session = store.createSession({
    workspaceId: workspace.id,
    ownerSlackUserId: 'UOWNER',
    title: 'Overnight coverage',
    mode: 'manual_review',
    channelScope: ['C1'],
    endsAt: new Date(Date.now() + 60 * 60 * 1000).toISOString()
  });

  return { store, normalizeSlackEvent, workspace, session };
}

function slackEvent(input: Record<string, unknown>): Record<string, unknown> {
  return {
    type: 'message',
    channel: 'C1',
    user: 'UASKER',
    text: '<@UOWNER> can you confirm the launch spec?',
    ts: '111.222',
    ...input
  };
}

describe('normalizeSlackEvent', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.MURPH_SQLITE_PATH = join(mkdtempSync(join(tmpdir(), 'murph-slack-adapter-')), 'murph.sqlite');
    process.env.MURPH_ENCRYPTION_KEY = 'test-key';
  });

  it('routes ordinary channel messages that mention an active session owner', async () => {
    const { normalizeSlackEvent } = await setup();

    const result = normalizeSlackEvent(slackEvent({}), { eventId: 'Ev1', teamId: 'T1' });

    expect(result.task?.targetUserId).toBe('UOWNER');
    expect(result.task?.thread).toMatchObject({ provider: 'slack', channelId: 'C1', threadTs: '111.222' });
    expect(result.task?.actorUserId).toBe('UASKER');
  });

  it('ignores ordinary messages when the mentioned user has no scoped active session', async () => {
    const { normalizeSlackEvent } = await setup();

    const result = normalizeSlackEvent(slackEvent({ text: '<@UOTHER> can you confirm this?' }), {
      eventId: 'Ev2',
      teamId: 'T1'
    });

    expect(result).toMatchObject({ ignoredReason: 'no_mentioned_session_owner' });
  });

  it('honors active session channel scope', async () => {
    const { normalizeSlackEvent } = await setup();

    const result = normalizeSlackEvent(slackEvent({ channel: 'C2' }), { eventId: 'Ev3', teamId: 'T1' });

    expect(result).toMatchObject({ ignoredReason: 'no_mentioned_session_owner' });
  });

  it('routes app mentions to the explicitly mentioned session owner instead of the bot', async () => {
    const { normalizeSlackEvent } = await setup();

    const result = normalizeSlackEvent(
      slackEvent({ type: 'app_mention', text: '<@UTZBOT> <@UOWNER> can you check this?' }),
      { eventId: 'Ev4', teamId: 'T1' }
    );

    expect(result.task?.targetUserId).toBe('UOWNER');
  });

  it('uses the single scoped session fallback only for bot-directed messages', async () => {
    const { normalizeSlackEvent } = await setup();

    const result = normalizeSlackEvent(slackEvent({ type: 'app_mention', text: '<@UTZBOT> help' }), {
      eventId: 'Ev5',
      teamId: 'T1'
    });

    expect(result.task?.targetUserId).toBe('UOWNER');
  });

  it('treats bot-directed fallback as ambiguous when multiple sessions are scoped to the channel', async () => {
    const { store, workspace, normalizeSlackEvent } = await setup();
    store.upsertUser({
      workspaceId: workspace.id,
      slackUserId: 'UOTHER',
      displayName: 'Other Owner'
    });
    store.createSession({
      workspaceId: workspace.id,
      ownerSlackUserId: 'UOTHER',
      title: 'Other coverage',
      mode: 'manual_review',
      channelScope: ['C1'],
      endsAt: new Date(Date.now() + 60 * 60 * 1000).toISOString()
    });

    const result = normalizeSlackEvent(slackEvent({ type: 'app_mention', text: '<@UTZBOT> help' }), {
      eventId: 'Ev6',
      teamId: 'T1'
    });

    expect(result).toMatchObject({ ignoredReason: 'ambiguous_session_target' });
  });

  it('uses stored thread state for continuations without requiring repeated mentions', async () => {
    const { store, workspace, session, normalizeSlackEvent } = await setup();
    store.upsertThreadState({
      workspaceId: workspace.id,
      sessionId: session.id,
      channelId: 'C1',
      threadTs: '111.222',
      targetUserId: 'UOWNER',
      lastMessageTs: '111.222',
      continuityCase: 'clarification',
      status: 'active'
    });

    const result = normalizeSlackEvent(
      slackEvent({ thread_ts: '111.222', ts: '111.333', text: 'any update?' }),
      { eventId: 'Ev7', teamId: 'T1' }
    );

    expect(result.task?.targetUserId).toBe('UOWNER');
  });

  it('ignores Slack bot messages and unsupported subtypes', async () => {
    const { normalizeSlackEvent } = await setup();

    expect(normalizeSlackEvent(slackEvent({ bot_id: 'B1' }), { eventId: 'Ev8', teamId: 'T1' })).toMatchObject({
      ignoredReason: 'bot_message'
    });
    expect(normalizeSlackEvent(slackEvent({ user: 'UTZBOT' }), { eventId: 'Ev9', teamId: 'T1' })).toMatchObject({
      ignoredReason: 'bot_message'
    });
    expect(
      normalizeSlackEvent(slackEvent({ subtype: 'message_changed' }), { eventId: 'Ev10', teamId: 'T1' })
    ).toMatchObject({
      ignoredReason: 'unsupported_event_subtype'
    });
  });

  it('advertises membership check and self-join capabilities', async () => {
    await setup();
    const { createSlackChannelAdapter } = await import('../src/lib/server/channels/slack/adapter');

    expect(createSlackChannelAdapter().capabilities).toEqual(
      expect.arrayContaining(['membership_check', 'self_join'])
    );
  });
});
