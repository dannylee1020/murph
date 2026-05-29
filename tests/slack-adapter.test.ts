import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AutopilotSession, Workspace } from '../shared/types';

interface SlackAdapterTestContext {
  store: Awaited<ReturnType<typeof loadStore>>;
  normalizeSlackEvent: typeof import('../shared/server/channels/slack/adapter').normalizeSlackEvent;
  workspace: Workspace;
  session: AutopilotSession;
}

async function loadStore() {
  const { getStore } = await import('../shared/server/persistence/store');
  return getStore();
}

async function setup(input: { subscribeOwner?: boolean } = {}): Promise<SlackAdapterTestContext> {
  const subscribeOwner = input.subscribeOwner ?? true;
  const store = await loadStore();
  const { normalizeSlackEvent } = await import('../shared/server/channels/slack/adapter');
  const workspace = store.saveInstall({
    provider: 'slack',
    externalWorkspaceId: 'T1',
    name: 'Test Workspace',
    botUserId: 'UTZBOT'
  });

  store.upsertUser({
    workspaceId: workspace.id,
    externalUserId: 'UOWNER',
    displayName: 'Owner'
  });
  if (subscribeOwner) {
    store.upsertWorkspaceSubscription({
      workspaceId: workspace.id,
      provider: 'slack',
      externalUserId: 'UOWNER',
      displayName: 'Owner',
      status: 'active',
      channelScopeMode: 'selected',
      channelScope: ['C1']
    });
  }

  const session = store.createSession({
    workspaceId: workspace.id,
    ownerUserId: 'UOWNER',
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
    const root = mkdtempSync(join(tmpdir(), 'murph-slack-adapter-'));
    process.env.MURPH_SQLITE_PATH = join(root, 'murph.sqlite');
    process.env.MURPH_CONFIG_PATH = join(root, 'config.yaml');
    process.env.MURPH_ENCRYPTION_KEY = 'test-key';
    delete process.env.MURPH_PRODUCT_MODE;
    delete process.env.MURPH_DISTRIBUTION;
  });

  it('routes ordinary channel messages that mention an active session owner', async () => {
    const { normalizeSlackEvent } = await setup();

    const result = normalizeSlackEvent(slackEvent({}), { eventId: 'Ev1', teamId: 'T1' });

    expect(result.task?.targetUserId).toBe('UOWNER');
    expect(result.task?.thread).toMatchObject({ provider: 'slack', channelId: 'C1', threadTs: '111.222' });
    expect(result.task?.actorUserId).toBe('UASKER');
    expect(result.task?.triggerMessage).toMatchObject({
      provider: 'slack',
      userId: 'UASKER',
      text: '<@UOWNER> can you confirm the launch spec?',
      ts: '111.222'
    });
  });

  it('does not route an active session owner without an active subscription', async () => {
    const { normalizeSlackEvent } = await setup({ subscribeOwner: false });

    const result = normalizeSlackEvent(slackEvent({}), { eventId: 'Ev12', teamId: 'T1' });

    expect(result).toMatchObject({ ignoredReason: 'no_mentioned_session_owner' });
  });

  it('routes teammate direct messages to the represented owner through a personal bot', async () => {
    const { store, workspace, normalizeSlackEvent } = await setup({ subscribeOwner: false });
    store.stopSession(store.listActiveSessions(workspace.id)[0].id, 'stopped');
    const personalInstall = store.upsertBotInstallation({
      workspaceId: workspace.id,
      provider: 'slack',
      externalWorkspaceId: workspace.externalWorkspaceId,
      role: 'personal',
      botUserId: 'UPERSONALBOT',
      representedUserId: 'UOWNER'
    });
    const { updateMurphSetupDefaults } = await import('../shared/server/setup/config-file');
    updateMurphSetupDefaults({
      channelProvider: 'slack',
      workspaceId: workspace.id,
      workspaceOwners: [
        {
          workspaceId: workspace.id,
          ownerUserId: 'UOWNER',
          ownerDisplayName: 'Owner'
        }
      ]
    });

    const result = normalizeSlackEvent(slackEvent({
      channel: 'D1',
      channel_type: 'im',
      user: 'UASKER',
      text: 'draft a reply',
      ts: '222.333'
    }), { eventId: 'EvDm', teamId: 'T1', botRole: 'personal', botInstallationId: personalInstall.id });

    expect(result.task).toMatchObject({
      workspaceId: 'T1',
      botRole: 'personal',
      botInstallationId: personalInstall.id,
      conversationKind: 'direct',
      targetUserId: 'UOWNER',
      actorUserId: 'UASKER',
      thread: { provider: 'slack', channelId: 'D1', threadTs: '222.333' }
    });
    expect(store.getDirectConversationByChannel('slack', 'D1')).toMatchObject({
      workspaceId: workspace.id,
      externalUserId: 'UASKER',
      botInstallationId: personalInstall.id
    });
  });

  it('routes owner direct messages in the personal distribution', async () => {
    process.env.MURPH_DISTRIBUTION = 'personal';
    const { store, workspace, normalizeSlackEvent } = await setup({ subscribeOwner: false });
    store.stopSession(store.listActiveSessions(workspace.id)[0].id, 'stopped');
    const personalInstall = store.upsertBotInstallation({
      workspaceId: workspace.id,
      provider: 'slack',
      externalWorkspaceId: workspace.externalWorkspaceId,
      role: 'personal',
      botUserId: 'UPERSONALBOT',
      representedUserId: 'UOWNER'
    });

    const result = normalizeSlackEvent(slackEvent({
      channel: 'D1',
      channel_type: 'im',
      user: 'UOWNER',
      text: 'check my notes',
      ts: '222.444'
    }), { eventId: 'EvOwnerDm', teamId: 'T1', botRole: 'personal', botInstallationId: personalInstall.id });

    expect(result.task).toMatchObject({
      conversationKind: 'direct',
      targetUserId: 'UOWNER',
      actorUserId: 'UOWNER',
      thread: { provider: 'slack', channelId: 'D1', threadTs: '222.444' }
    });
  });

  it('ignores non-owner direct messages in the personal distribution', async () => {
    process.env.MURPH_DISTRIBUTION = 'personal';
    const { store, workspace, normalizeSlackEvent } = await setup({ subscribeOwner: false });
    const personalInstall = store.upsertBotInstallation({
      workspaceId: workspace.id,
      provider: 'slack',
      externalWorkspaceId: workspace.externalWorkspaceId,
      role: 'personal',
      botUserId: 'UPERSONALBOT',
      representedUserId: 'UOWNER'
    });

    const result = normalizeSlackEvent(slackEvent({
      channel: 'D1',
      channel_type: 'im',
      user: 'UASKER',
      text: 'draft a reply',
      ts: '222.555'
    }), { eventId: 'EvNonOwnerDm', teamId: 'T1', botRole: 'personal', botInstallationId: personalInstall.id });

    expect(result).toMatchObject({ ignoredReason: 'personal_owner_mismatch' });
  });

  it('uses the single scoped subscribed session fallback only for bot-directed messages', async () => {
    const { normalizeSlackEvent } = await setup();

    const result = normalizeSlackEvent(slackEvent({ type: 'app_mention', text: '<@UTZBOT> help' }), {
      eventId: 'Ev5',
      teamId: 'T1'
    });

    expect(result.task?.targetUserId).toBe('UOWNER');
  });

  it('ignores a mentioned session owner when subscriptions exist and the owner is not subscribed to the channel', async () => {
    const { store, workspace, normalizeSlackEvent } = await setup();
    store.upsertWorkspaceSubscription({
      workspaceId: workspace.id,
      provider: 'slack',
      externalUserId: 'UOWNER',
      displayName: 'Owner',
      status: 'active',
      channelScopeMode: 'selected',
      channelScope: ['C2']
    });

    const result = normalizeSlackEvent(slackEvent({}), { eventId: 'Ev11', teamId: 'T1' });

    expect(result).toMatchObject({ ignoredReason: 'no_mentioned_session_owner' });
  });

  it('treats bot-directed fallback as ambiguous when multiple sessions are scoped to the channel', async () => {
    const { store, workspace, normalizeSlackEvent } = await setup();
    store.upsertUser({
      workspaceId: workspace.id,
      externalUserId: 'UOTHER',
      displayName: 'Other Owner'
    });
    store.upsertWorkspaceSubscription({
      workspaceId: workspace.id,
      provider: 'slack',
      externalUserId: 'UOTHER',
      displayName: 'Other Owner',
      status: 'active',
      channelScopeMode: 'selected',
      channelScope: ['C1']
    });
    store.createSession({
      workspaceId: workspace.id,
      ownerUserId: 'UOTHER',
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

});
