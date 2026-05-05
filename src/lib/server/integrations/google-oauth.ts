import { encryptString, decryptString } from '#lib/server/util/crypto';
import { getRuntimeEnv } from '#lib/server/util/env';
import { getStore } from '#lib/server/persistence/store';
import { readEnvCredential } from './registry.js';

const SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/userinfo.email'
].join(' ');

interface OAuthBundle {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  scope: string;
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope: string;
  token_type: string;
}

export function isGoogleOAuthConfigured(): boolean {
  const env = getRuntimeEnv();
  return Boolean(env.googleClientId && env.googleClientSecret);
}

export function buildGoogleInstallUrl(redirectUri: string, state?: string): string {
  const env = getRuntimeEnv();
  if (!env.googleClientId) {
    throw new Error('GOOGLE_CLIENT_ID is not configured');
  }

  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.searchParams.set('client_id', env.googleClientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', SCOPES);
  url.searchParams.set('access_type', 'offline');
  url.searchParams.set('prompt', 'consent');
  if (state) {
    url.searchParams.set('state', state);
  }
  return url.toString();
}

export async function exchangeGoogleCode(
  code: string,
  redirectUri: string,
  workspaceId: string
): Promise<{ email?: string }> {
  const env = getRuntimeEnv();
  if (!env.googleClientId || !env.googleClientSecret) {
    throw new Error('Google OAuth is not configured');
  }

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: env.googleClientId,
      client_secret: env.googleClientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code'
    })
  });

  const payload = await response.json() as TokenResponse & { error?: string; error_description?: string };
  if (!response.ok) {
    throw new Error(payload.error_description ?? payload.error ?? 'Google token exchange failed');
  }

  const store = getStore();
  const existing = store.getIntegrationCredential(workspaceId, 'google');
  let existingBundle: Partial<OAuthBundle> = {};
  if (existing?.status === 'connected' && env.encryptionKey) {
    try {
      existingBundle = JSON.parse(decryptString(existing.credentialEncrypted, env.encryptionKey));
    } catch {}
  }

  const bundle: OAuthBundle = {
    access_token: payload.access_token,
    refresh_token: payload.refresh_token ?? existingBundle.refresh_token ?? '',
    expires_at: Date.now() + payload.expires_in * 1000,
    scope: payload.scope
  };

  if (!bundle.refresh_token) {
    throw new Error('Google did not return a refresh token. Try revoking access at myaccount.google.com and reconnecting.');
  }

  let email: string | undefined;
  try {
    const userInfo = await fetch('https://www.googleapis.com/oauth2/v1/userinfo', {
      headers: { Authorization: `Bearer ${bundle.access_token}` }
    });
    const profile = await userInfo.json() as { email?: string };
    email = profile.email;
  } catch {}

  store.saveIntegrationCredential({
    workspaceId,
    provider: 'google',
    credentialKind: 'oauth_bundle',
    credentialEncrypted: encryptString(JSON.stringify(bundle), env.encryptionKey),
    metadata: {
      account: email,
      validatedAt: new Date().toISOString()
    }
  });

  return { email };
}

async function refreshAccessToken(bundle: OAuthBundle): Promise<OAuthBundle> {
  const env = getRuntimeEnv();
  if (!env.googleClientId || !env.googleClientSecret) {
    throw new Error('Google OAuth is not configured');
  }

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: bundle.refresh_token,
      client_id: env.googleClientId,
      client_secret: env.googleClientSecret,
      grant_type: 'refresh_token'
    })
  });

  const payload = await response.json() as TokenResponse & { error?: string; error_description?: string };
  if (!response.ok) {
    throw new Error(payload.error_description ?? payload.error ?? 'Google token refresh failed');
  }

  return {
    access_token: payload.access_token,
    refresh_token: payload.refresh_token ?? bundle.refresh_token,
    expires_at: Date.now() + payload.expires_in * 1000,
    scope: payload.scope ?? bundle.scope
  };
}

export async function getValidGoogleAccessToken(workspaceId: string): Promise<string> {
  const env = getRuntimeEnv();

  const store = getStore();
  const stored = store.getIntegrationCredential(workspaceId, 'google');

  if (stored?.status === 'connected' && env.encryptionKey) {
    let bundle: OAuthBundle;
    try {
      bundle = JSON.parse(decryptString(stored.credentialEncrypted, env.encryptionKey));
    } catch {
      throw new Error('Failed to decrypt Google credential');
    }

    if (bundle.refresh_token && bundle.expires_at < Date.now() + 60_000) {
      const refreshed = await refreshAccessToken(bundle);
      store.saveIntegrationCredential({
        workspaceId,
        provider: 'google',
        credentialKind: 'oauth_bundle',
        credentialEncrypted: encryptString(JSON.stringify(refreshed), env.encryptionKey),
        metadata: stored.metadata
      });
      return refreshed.access_token;
    }

    return bundle.access_token;
  }

  const envToken = readEnvCredential('google');
  if (envToken) {
    return envToken;
  }

  throw new Error('No Google credential available');
}

export async function revokeGoogleToken(workspaceId: string): Promise<void> {
  const env = getRuntimeEnv();
  const store = getStore();
  const stored = store.getIntegrationCredential(workspaceId, 'google');

  if (stored?.status === 'connected' && env.encryptionKey) {
    try {
      const bundle: OAuthBundle = JSON.parse(decryptString(stored.credentialEncrypted, env.encryptionKey));
      const token = bundle.refresh_token || bundle.access_token;
      await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
      });
    } catch {}
  }
}
