import type {
  ChannelAdapter,
  ChannelEnsureMemberResult,
  ChannelConnector,
  ChannelIngress,
  ChannelMembershipStatus,
  ChannelMessage,
  ChannelPlugin,
  ChannelProvider,
  ChannelSetupChannel,
  ChannelSetupMember,
  ChannelThreadRef,
  ContinuityTask,
  Workspace
} from '#lib/types';

type ChannelSource = 'builtin' | 'plugin' | 'runtime';

interface RegisteredChannel {
  plugin: ChannelPlugin;
  source: ChannelSource;
  filePath?: string;
}

export class ChannelRegistry {
  private readonly channels = new Map<ChannelProvider, RegisteredChannel>();

  register(adapter: ChannelAdapter): void {
    this.registerPlugin({
      id: adapter.id,
      displayName: adapter.displayName,
      adapter
    }, { source: 'runtime' });
  }

  registerPlugin(plugin: ChannelPlugin, opts: { source: ChannelSource; filePath?: string }): void {
    if (!plugin.id || !/^[a-z0-9][a-z0-9._-]*$/i.test(plugin.id)) {
      throw new Error(`Invalid channel id: ${plugin.id || '<empty>'}`);
    }
    if (!plugin.adapter || plugin.adapter.id !== plugin.id) {
      throw new Error(`Channel plugin ${plugin.id} adapter id must match plugin id`);
    }
    if (this.channels.has(plugin.id)) {
      throw new Error(`Channel adapter already registered: ${plugin.id}`);
    }

    this.channels.set(plugin.id, {
      plugin,
      source: opts.source,
      filePath: opts.filePath
    });
  }

  get(provider: ChannelProvider): ChannelAdapter {
    const adapter = this.channels.get(provider)?.plugin.adapter;

    if (!adapter) {
      throw new Error(`Unknown channel adapter: ${provider}`);
    }

    return adapter;
  }

  getPlugin(provider: ChannelProvider): ChannelPlugin {
    const plugin = this.channels.get(provider)?.plugin;
    if (!plugin) {
      throw new Error(`Unknown channel adapter: ${provider}`);
    }
    return plugin;
  }

  getConnector(provider: ChannelProvider): ChannelConnector | undefined {
    return this.channels.get(provider)?.plugin.connector;
  }

  getIngress(provider: ChannelProvider): ChannelIngress | undefined {
    return this.channels.get(provider)?.plugin.ingress;
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

  async listMembers(workspace: Workspace): Promise<ChannelSetupMember[]> {
    const connector = this.getConnector(workspace.provider);
    if (!connector?.listMembers) {
      throw new Error(`Channel ${workspace.provider} does not support member discovery`);
    }
    return connector.listMembers(workspace);
  }

  async getMember(workspace: Workspace, userId: string): Promise<ChannelSetupMember> {
    const connector = this.getConnector(workspace.provider);
    if (!connector?.getMember) {
      throw new Error(`Channel ${workspace.provider} does not support member lookup`);
    }
    return connector.getMember(workspace, userId);
  }

  async listChannels(workspace: Workspace): Promise<ChannelSetupChannel[]> {
    const connector = this.getConnector(workspace.provider);
    if (!connector?.listChannels) {
      throw new Error(`Channel ${workspace.provider} does not support channel discovery`);
    }
    return connector.listChannels(workspace);
  }

  async getChannel(workspace: Workspace, channelId: string): Promise<ChannelSetupChannel> {
    const connector = this.getConnector(workspace.provider);
    if (!connector?.getChannel) {
      throw new Error(`Channel ${workspace.provider} does not support channel lookup`);
    }
    return connector.getChannel(workspace, channelId);
  }

  async startIngress(): Promise<void> {
    await Promise.all([...this.channels.values()].map(async ({ plugin }) => {
      await plugin.ingress?.start?.({ provider: plugin.id });
    }));
  }

  unregisterBySource(source: ChannelSource): void {
    for (const [id, registered] of this.channels.entries()) {
      if (registered.source === source) {
        this.channels.delete(id);
      }
    }
  }

  list() {
    return [...this.channels.values()].map(({ plugin, source, filePath }) => ({
      id: plugin.id,
      displayName: plugin.displayName,
      description: plugin.description,
      version: plugin.version,
      source,
      filePath,
      capabilities: plugin.adapter.capabilities,
      setup: {
        configurable: Boolean(plugin.connector),
        requirements: plugin.connector?.requirements ?? []
      },
      ingress: {
        startable: Boolean(plugin.ingress?.start),
        webhook: Boolean(plugin.ingress?.handleWebhook)
      }
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
