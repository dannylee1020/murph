import { getStore } from '#shared/server/persistence/store';
import { getSlackService } from '#shared/server/channels/slack/service';
import { getDiscordService } from '#shared/server/channels/discord/service';
import type { BotInstallation, ChannelProvider, Workspace } from '#shared/types';

export interface PersonalHandoffTarget {
  provider: ChannelProvider;
  workspace: Workspace;
  installation: BotInstallation;
  ownerUserId: string;
  ownerDisplayName: string;
}

export type PersonalHandoffResult =
  | {
      ok: true;
      ownerUserId: string;
      ownerDisplayName: string;
      channelId: string;
      message: string;
    }
  | {
      ok: false;
      error: 'no_personal_bot' | 'owner_required' | 'owner_not_found' | 'dm_open_failed';
      message: string;
    };
type PersonalHandoffError = Extract<PersonalHandoffResult, { ok: false }>;

function ownerDisplayName(workspace: Workspace, ownerUserId: string): string {
  return getStore().getUser(workspace.id, ownerUserId)?.displayName ?? ownerUserId;
}

function ownerMatches(target: PersonalHandoffTarget, hint: string | undefined): boolean {
  if (!hint) return false;
  const normalized = hint.trim().toLowerCase();
  if (!normalized) return false;
  return target.ownerUserId.toLowerCase() === normalized ||
    target.ownerDisplayName.toLowerCase() === normalized ||
    target.ownerDisplayName.toLowerCase().includes(normalized);
}

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

export function listPersonalHandoffTargets(
  provider: ChannelProvider,
  input: { externalWorkspaceId?: string } = {}
): PersonalHandoffTarget[] {
  const store = getStore();
  const appId = currentPersonalAppId(provider);
  return store
    .listBotInstallations({ provider, role: 'personal' })
    .filter((installation) => (
      installation.status === 'active' &&
      Boolean(installation.representedUserId) &&
      (provider !== 'slack' && provider !== 'discord' ? true : Boolean(appId && installation.appId === appId))
    ))
    .map((installation) => {
      const workspace = store.getWorkspaceById(installation.workspaceId);
      if (!workspace) return undefined;
      if (input.externalWorkspaceId && workspace.externalWorkspaceId !== input.externalWorkspaceId) return undefined;
      const ownerUserId = installation.representedUserId!;
      return {
        provider,
        workspace,
        installation,
        ownerUserId,
        ownerDisplayName: ownerDisplayName(workspace, ownerUserId)
      };
    })
    .filter((target): target is PersonalHandoffTarget => Boolean(target));
}

export function resolvePersonalHandoffTarget(
  provider: ChannelProvider,
  input: { externalWorkspaceId?: string; ownerUserId?: string; ownerHint?: string } = {}
): PersonalHandoffTarget | PersonalHandoffError {
  const targets = listPersonalHandoffTargets(provider, input);
  if (targets.length === 0) {
    return {
      ok: false,
      error: 'no_personal_bot',
      message: 'No Murph Personal bot is configured yet.'
    };
  }

  const exact = input.ownerUserId
    ? targets.find((target) => target.ownerUserId === input.ownerUserId)
    : undefined;
  if (exact) return exact;

  const hinted = input.ownerHint
    ? targets.filter((target) => ownerMatches(target, input.ownerHint))
    : [];
  if (hinted.length === 1) return hinted[0];

  if (!input.ownerUserId && !input.ownerHint && targets.length === 1) {
    return targets[0];
  }

  return {
    ok: false,
    error: input.ownerUserId || input.ownerHint ? 'owner_not_found' : 'owner_required',
    message: targets.length === 1
      ? `Use /murph ${targets[0].ownerDisplayName} to open that Murph Personal bot.`
      : `Add the offline owner after /murph. Available owners: ${targets.map((target) => target.ownerDisplayName).join(', ')}.`
  };
}

function handoffText(target: PersonalHandoffTarget, selectedText?: string): string {
  const intro = `This is Murph Personal for ${target.ownerDisplayName}. Send your request here.`;
  const trimmed = selectedText?.trim();
  return trimmed ? `${intro}\n\nSelected message:\n${trimmed}` : intro;
}

function isHandoffError(value: PersonalHandoffTarget | PersonalHandoffError): value is PersonalHandoffError {
  return 'ok' in value;
}

export async function openSlackPersonalHandoff(input: {
  teamId?: string;
  senderUserId: string;
  ownerUserId?: string;
  ownerHint?: string;
  selectedText?: string;
}): Promise<PersonalHandoffResult> {
  const target = resolvePersonalHandoffTarget('slack', {
    externalWorkspaceId: input.teamId,
    ownerUserId: input.ownerUserId,
    ownerHint: input.ownerHint
  });
  if (isHandoffError(target)) return target;

  try {
    const channelId = await getSlackService().openDirectMessage(
      target.workspace,
      input.senderUserId,
      target.installation.id
    );
    getStore().upsertDirectConversation({
      provider: 'slack',
      botInstallationId: target.installation.id,
      workspaceId: target.workspace.id,
      externalUserId: input.senderUserId,
      channelId,
      lastSelectedWorkspaceId: target.workspace.id
    });
    await getSlackService().postMessage(target.workspace, channelId, handoffText(target, input.selectedText), undefined, target.installation.id);
    return {
      ok: true,
      ownerUserId: target.ownerUserId,
      ownerDisplayName: target.ownerDisplayName,
      channelId,
      message: `Opened Murph Personal for ${target.ownerDisplayName}. Continue in that DM.`
    };
  } catch (error) {
    return {
      ok: false,
      error: 'dm_open_failed',
      message: error instanceof Error ? error.message : 'Murph could not open the personal bot DM.'
    };
  }
}

export async function openDiscordPersonalHandoff(input: {
  senderUserId: string;
  ownerUserId?: string;
  ownerHint?: string;
  selectedText?: string;
}): Promise<PersonalHandoffResult> {
  const target = resolvePersonalHandoffTarget('discord', {
    ownerUserId: input.ownerUserId,
    ownerHint: input.ownerHint
  });
  if (isHandoffError(target)) return target;

  try {
    const channelId = await getDiscordService().openDirectMessage(input.senderUserId, 'personal', target.installation.id);
    getStore().upsertDirectConversation({
      provider: 'discord',
      botInstallationId: target.installation.id,
      workspaceId: target.workspace.id,
      externalUserId: input.senderUserId,
      channelId,
      lastSelectedWorkspaceId: target.workspace.id
    });
    await getDiscordService().postDirectMessage(channelId, handoffText(target, input.selectedText), 'personal', target.installation.id);
    return {
      ok: true,
      ownerUserId: target.ownerUserId,
      ownerDisplayName: target.ownerDisplayName,
      channelId,
      message: `Opened Murph Personal for ${target.ownerDisplayName}. Continue in that DM.`
    };
  } catch (error) {
    return {
      ok: false,
      error: 'dm_open_failed',
      message: error instanceof Error ? error.message : 'Murph could not open the personal bot DM.'
    };
  }
}
