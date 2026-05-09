import type {
  AutopilotSession,
  ContextSource,
  SessionContextSnapshot,
  ToolDefinition,
  Workspace,
  WorkspaceMemory
} from '#lib/types';
import type { IntegrationAuthType } from './registry.js';

export interface SessionContextContributorInput {
  workspace: Workspace;
  session: AutopilotSession;
  workspaceMemory: WorkspaceMemory;
  date: string;
  nextDate: string;
  timezone?: string;
}

export interface SessionContextContribution {
  handoffDoc?: SessionContextSnapshot['handoffDoc'];
  sections?: SessionContextSnapshot['sections'];
}

export interface SessionContextContributor {
  contribute(input: SessionContextContributorInput): Promise<SessionContextContribution>;
}

export interface IntegrationAdapter {
  id: string;
  name: string;
  description: string;
  credential: {
    authType: IntegrationAuthType;
    credentialKind: 'api_key' | 'oauth_bundle';
    envKey: string;
    credentialLabel: string;
    installPath?: string;
  };
  tools?: Array<ToolDefinition<any, any>>;
  contextSources?: ContextSource[];
  isConfigured(workspaceId?: string): boolean;
  sessionContext?: SessionContextContributor;
}

