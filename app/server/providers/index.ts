import { DEFAULT_PROVIDER_MODEL } from '#app/config';
import { getRegisteredProviderFactory } from '#app/server/capabilities/plugins';
import { getRuntimeEnv } from '#app/server/util/env';
import { AnthropicProvider } from '#app/server/providers/anthropic';
import { OpenAIProvider } from '#app/server/providers/openai';
import type { ModelProvider, ProviderName, ProviderSettings } from '#app/types';

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
