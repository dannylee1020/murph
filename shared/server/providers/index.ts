import { DEFAULT_PROVIDER_MODEL } from '#shared/config';
import { getRegisteredProviderFactory } from '#shared/server/capabilities/plugins';
import { getRuntimeEnv } from '#shared/server/util/env';
import { AnthropicProvider } from '#shared/server/providers/anthropic';
import { OpenAIProvider } from '#shared/server/providers/openai';
import type { ModelProvider, ProviderName, ProviderSettings } from '#shared/types';

export function getModelProvider(settings?: ProviderSettings): ModelProvider {
  const env = getRuntimeEnv();
  const providerName: ProviderName = settings?.provider ?? env.defaultProvider;
  const model = settings?.model ??
    (providerName === env.defaultProvider ? env.defaultModel : DEFAULT_PROVIDER_MODEL[providerName]);
  const pluginFactory = getRegisteredProviderFactory(providerName);

  if (pluginFactory) {
    return pluginFactory();
  }

  if (providerName === 'anthropic') {
    return new AnthropicProvider(model);
  }

  return new OpenAIProvider(model);
}

export function getPolicyModelProvider(): ModelProvider {
  const env = getRuntimeEnv();
  return getModelProvider({
    workspaceId: 'policy',
    provider: env.policyProvider,
    model: env.policyModel
  });
}
