import { registerAdapter } from './adapter-registry.js';
import { createGitHubAdapter } from './github/index.js';
import { createLinearAdapter } from './linear/index.js';
import { createNotionAdapter } from './notion/index.js';

let initialized = false;

export function registerBuiltInIntegrationAdapters(): void {
  if (initialized) {
    return;
  }

  for (const adapter of [
    createGitHubAdapter(),
    createNotionAdapter(),
    createLinearAdapter()
  ]) {
    registerAdapter(adapter, { source: 'builtin' });
  }

  initialized = true;
}
