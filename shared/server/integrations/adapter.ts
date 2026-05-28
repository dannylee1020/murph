import type {
  ContextSource,
  ToolDefinition,
} from '#shared/types';
import type { IntegrationAuthType } from './registry.js';

export interface IntegrationAdapter {
  id: string;
  name: string;
  description: string;
  credential: {
    authType: IntegrationAuthType;
    credentialKind: 'api_key' | 'oauth_bundle' | 'config_path';
    envKey: string;
    credentialLabel: string;
    installPath?: string;
  };
  tools?: Array<ToolDefinition<any, any>>;
  contextSources?: ContextSource[];
  isConfigured(workspaceId?: string): boolean;
}
