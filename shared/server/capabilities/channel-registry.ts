import type {
  ChannelAdapter,
  ChannelEnsureMemberResult,
  ChannelIngress,
  ChannelMembershipStatus,
  ChannelMessage,
  ChannelPlugin,
  ChannelProvider,
  ChannelSetup,
  ChannelSetupChannel,
  ChannelSetupMember,
  ChannelThreadRef,
  ContinuityTask,
  Workspace
} from '#shared/types';

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
      runtime: adapter
    }, { source: 'runtime' });
  }

  registerPlugin(plugin: ChannelPlugin, opts: { source: ChannelSource; filePath?: string }): void {
    if (!plugin.id || !/^[a-z0-9][a-z0-9._-]*$/i.test(plugin.id)) {
      throw new Error(`Invalid channel id: ${plugin.id || '<empty>'}`);
    }
    if (!plugin.runtime || plugin.runtime.id !== plugin.id) {
      throw new Error(`Channel plugin ${plugin.id} runtime id must match plugin id`);
    }
    if (this.channels.has(plugin.id)) {
      throw new Error(`Channel already registered: ${plugin.id}`);
    }

    this.channels.set(plugin.id, {
      plugin,
      source: opts.source,
      filePath: opts.filePath
    });
  }

  get(provider: ChannelProvider): ChannelAdapter {
    const runtime = this.channels.get(provider)?.plugin.runtime;

    if (!runtime) {
      throw new Error(`Unknown channel runtime: ${provider}`);
    }

    return runtime;
  }

  getPlugin(provider: ChannelProvider): ChannelPlugin {
    const plugin = this.channels.get(provider)?.plugin;
    if (!plugin) {
      throw new Error(`Unknown channel: ${provider}`);
    }
    return plugin;
  }

  getSetup(provider: ChannelProvider): ChannelSetup | undefined {
    return this.channels.get(provider)?.plugin.setup;
  }

  getIngress(provider: ChannelProvider): ChannelIngress | undefined {
    return this.channels.get(provider)?.plugin.ingress;
  }

  normalizeEvent(
    provider: ChannelProvider,
    event: Record<string, unknown>,
    envelope?: { eventId?: string; teamId?: string; botRole?: 'personal' | 'channel'; botInstallationId?: string }
  ): ContinuityTask | null {
    return this.get(provider).normalizeEvent(event, envelope);
  }

  async fetchThread(workspace: Workspace, thread: ChannelThreadRef): Promise<ChannelMessage[]> {
    return await this.get(thread.provider ?? workspace.provider).fetchThread(workspace, thread);
  }

  async postReply(workspace: Workspace, thread: ChannelThreadRef, text: string): Promise<void> {
    await this.get(thread.provider ?? workspace.provider).postReply(workspace, thread, text);
  }

  async postMessage(workspace: Workspace, provider: ChannelProvider, channelId: string, text: string): Promise<{ ts?: string }> {
    const runtime = this.get(provider);
    if (!runtime.postMessage) {
      throw new Error(`Channel runtime ${provider} does not support top-level messages`);
    }
    return await runtime.postMessage(workspace, channelId, text);
  }

  async checkMembership(
    workspace: Workspace,
    provider: ChannelProvider,
    channelId: string
  ): Promise<ChannelMembershipStatus | undefined> {
    const runtime = this.get(provider);
    if (!runtime.checkMembership) {
      return undefined;
    }
    return await runtime.checkMembership(workspace, channelId);
  }

  async ensureMember(
    workspace: Workspace,
    provider: ChannelProvider,
    channelId: string
  ): Promise<ChannelEnsureMemberResult> {
    const runtime = this.get(provider);
    if (!runtime.ensureMember) {
      return {
        channelId,
        status: 'already_member'
      };
    }
    return await runtime.ensureMember(workspace, channelId);
  }

  async listMembers(workspace: Workspace): Promise<ChannelSetupMember[]> {
    const setup = this.getSetup(workspace.provider);
    if (!setup?.listMembers) {
      throw new Error(`Channel ${workspace.provider} does not support member discovery`);
    }
    return setup.listMembers(workspace);
  }

  async getMember(workspace: Workspace, userId: string): Promise<ChannelSetupMember> {
    const setup = this.getSetup(workspace.provider);
    if (!setup?.getMember) {
      throw new Error(`Channel ${workspace.provider} does not support member lookup`);
    }
    return setup.getMember(workspace, userId);
  }

  async listChannels(workspace: Workspace): Promise<ChannelSetupChannel[]> {
    const setup = this.getSetup(workspace.provider);
    if (!setup?.listChannels) {
      throw new Error(`Channel ${workspace.provider} does not support channel discovery`);
    }
    return setup.listChannels(workspace);
  }

  async getChannel(workspace: Workspace, channelId: string): Promise<ChannelSetupChannel> {
    const setup = this.getSetup(workspace.provider);
    if (!setup?.getChannel) {
      throw new Error(`Channel ${workspace.provider} does not support channel lookup`);
    }
    return setup.getChannel(workspace, channelId);
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
      capabilities: plugin.runtime.capabilities,
      setup: {
        configurable: Boolean(plugin.setup),
        requirements: plugin.setup?.requirements ?? []
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
