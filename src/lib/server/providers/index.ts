import { DEFAULT_PROVIDER_MODEL } from '#lib/config';
import { getRegisteredProviderFactory } from '#lib/server/capabilities/plugins';
import { AnthropicProvider } from '#lib/server/providers/anthropic';
import { OpenAIProvider } from '#lib/server/providers/openai';
import type { ModelProvider, ProviderName, ProviderSettings } from '#lib/types';

export function getModelProvider(settings?: ProviderSettings): ModelProvider {
  const providerName: ProviderName = settings?.provider ?? 'openai';
  const model = settings?.model ?? DEFAULT_PROVIDER_MODEL[providerName];
  const pluginFactory = getRegisteredProviderFactory(providerName);

  if (pluginFactory) {
    return pluginFactory();
  }

  if (providerName === 'anthropic') {
    return new AnthropicProvider(model);
  }

  return new OpenAIProvider(model);
}
