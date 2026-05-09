import { getRuntimeEnv } from '#lib/server/util/env';

type EnvCredentialReader = () => string | undefined;

interface EnvCredentialEntry {
  envKey: string;
  reader?: EnvCredentialReader;
}

const envCredentials = new Map<string, EnvCredentialEntry>([
  ['github', { envKey: 'GITHUB_PAT', reader: () => getRuntimeEnv().githubPat }],
  ['notion', { envKey: 'NOTION_API_KEY', reader: () => getRuntimeEnv().notionApiKey }],
  ['granola', { envKey: 'GRANOLA_API_KEY', reader: () => getRuntimeEnv().granolaApiKey }],
  ['google', { envKey: 'GOOGLE_ACCESS_TOKEN', reader: () => getRuntimeEnv().googleAccessToken }]
]);

export function registerEnvCredential(provider: string, envKey: string, reader?: EnvCredentialReader): void {
  const current = envCredentials.get(provider);
  envCredentials.set(provider, { envKey, reader: reader ?? current?.reader });
}

export function readEnvCredential(provider: string): string | undefined {
  const entry = envCredentials.get(provider);
  if (!entry) {
    return undefined;
  }

  return entry.reader?.() ?? process.env[entry.envKey];
}
