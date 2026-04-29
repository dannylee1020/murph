import type {
  ChannelAdapter,
  ChannelEnsureMemberResult,
  ChannelMembershipStatus,
  ChannelMessage,
  ChannelProvider,
  ChannelThreadRef,
  ContinuityTask,
  Workspace
} from '#lib/types';

export class ChannelRegistry {
  private readonly adapters = new Map<ChannelProvider, ChannelAdapter>();

  register(adapter: ChannelAdapter): void {
    if (this.adapters.has(adapter.id)) {
      throw new Error(`Channel adapter already registered: ${adapter.id}`);
    }

    this.adapters.set(adapter.id, adapter);
  }

  get(provider: ChannelProvider): ChannelAdapter {
    const adapter = this.adapters.get(provider);

    if (!adapter) {
      throw new Error(`Unknown channel adapter: ${provider}`);
    }

    return adapter;
  }

  normalizeEvent(
    provider: ChannelProvider,
    event: Record<string, unknown>,
    envelope?: { eventId?: string; teamId?: string }
  ): ContinuityTask | null {
    return this.get(provider).normalizeEvent(event, envelope);
  }

  async fetchThread(workspace: Workspace, thread: ChannelThreadRef): Promise<ChannelMessage[]> {
    return await this.get(thread.provider ?? 'slack').fetchThread(workspace, thread);
  }

  async postReply(workspace: Workspace, thread: ChannelThreadRef, text: string): Promise<void> {
    await this.get(thread.provider ?? 'slack').postReply(workspace, thread, text);
  }

  async postMessage(workspace: Workspace, provider: ChannelProvider, channelId: string, text: string): Promise<{ ts?: string }> {
    const adapter = this.get(provider);
    if (!adapter.postMessage) {
      throw new Error(`Channel adapter ${provider} does not support top-level messages`);
    }
    return await adapter.postMessage(workspace, channelId, text);
  }

  async checkMembership(
    workspace: Workspace,
    provider: ChannelProvider,
    channelId: string
  ): Promise<ChannelMembershipStatus | undefined> {
    const adapter = this.get(provider);
    if (!adapter.checkMembership) {
      return undefined;
    }
    return await adapter.checkMembership(workspace, channelId);
  }

  async ensureMember(
    workspace: Workspace,
    provider: ChannelProvider,
    channelId: string
  ): Promise<ChannelEnsureMemberResult> {
    const adapter = this.get(provider);
    if (!adapter.ensureMember) {
      return {
        channelId,
        status: 'already_member'
      };
    }
    return await adapter.ensureMember(workspace, channelId);
  }

  list() {
    return [...this.adapters.values()].map((adapter) => ({
      id: adapter.id,
      displayName: adapter.displayName,
      capabilities: adapter.capabilities
    }));
  }
}

let registry: ChannelRegistry | null = null;

export function getChannelRegistry(): ChannelRegistry {
  if (!registry) {
    registry = new ChannelRegistry();
  }

  return registry;
}
