import type { SetupStatusPayload } from './types';
import { escapeHtml } from './format';

const DEFAULT_AGENT_MODELS: Record<string, string> = {
    openai: 'gpt-5.5',
    anthropic: 'claude-opus-4-7',
};

export function agentProvider(setup: SetupStatusPayload): string {
    return (
        setup.provider.agentProvider ??
        setup.provider.defaultProvider ??
        'openai'
    );
}

export function agentModel(setup: SetupStatusPayload): string {
    const provider = agentProvider(setup);
    const defaults = setup.provider.defaultAgentModels ?? DEFAULT_AGENT_MODELS;
    return (
        setup.provider.agentModel ??
        defaults[provider] ??
        DEFAULT_AGENT_MODELS.openai
    );
}

export function runtimeModel(setup: SetupStatusPayload): string {
    const provider = setup.provider.defaultProvider ?? 'openai';
    const defaults = setup.provider.defaultAgentModels ?? DEFAULT_AGENT_MODELS;
    return (
        setup.provider.defaultModel ??
        defaults[provider] ??
        DEFAULT_AGENT_MODELS.openai
    );
}

export function agentModelFields(setup: SetupStatusPayload): string {
    const selectedProvider = agentProvider(setup);
    const selectedModel = agentModel(setup);
    const defaults = setup.provider.defaultAgentModels ?? DEFAULT_AGENT_MODELS;
    const inherits = setup.provider.agentInheritsRuntime !== false;
    return `
    <label>
      <span>Murph Agent default</span>
      <select name="agentModelMode">
        <option value="inherit" ${inherits ? 'selected' : ''}>Inherit runtime model (${escapeHtml(`${setup.provider.defaultProvider} / ${runtimeModel(setup)}`)})</option>
        <option value="custom" ${inherits ? '' : 'selected'}>Use a separate agent model</option>
      </select>
    </label>
    <label>
      <span>Murph Agent provider</span>
      <select name="agentProvider">
        <option value="openai" ${selectedProvider === 'openai' ? 'selected' : ''}>OpenAI</option>
        <option value="anthropic" ${selectedProvider === 'anthropic' ? 'selected' : ''}>Anthropic</option>
      </select>
    </label>
    <label>
      <span>Separate Murph Agent model</span>
      <input name="agentModel" list="agent-model-presets" value="${escapeHtml(selectedModel)}" autocomplete="off" required />
      <datalist id="agent-model-presets">
        <option value="${escapeHtml(defaults.openai ?? DEFAULT_AGENT_MODELS.openai)}">OpenAI recommended</option>
        <option value="${escapeHtml(defaults.anthropic ?? DEFAULT_AGENT_MODELS.anthropic)}">Anthropic recommended</option>
      </datalist>
    </label>
  `;
}
