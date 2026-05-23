import { registerAdapter } from './adapter-registry.js';
import { createGitHubAdapter } from './github/index.js';
import { createGoogleAdapter } from './google/index.js';
import { createGranolaAdapter } from './granola/index.js';
import { createNotionAdapter } from './notion/index.js';
import { createObsidianAdapter } from './obsidian/index.js';

let initialized = false;

export function registerBuiltInIntegrationAdapters(): void {
  if (initialized) {
    return;
  }

  for (const adapter of [
    createGitHubAdapter(),
    createNotionAdapter(),
    createObsidianAdapter(),
    createGranolaAdapter(),
    createGoogleAdapter()
  ]) {
    registerAdapter(adapter, { source: 'builtin' });
  }

  initialized = true;
}
