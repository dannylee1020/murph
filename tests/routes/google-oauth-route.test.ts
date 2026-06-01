import { Readable } from 'node:stream';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

type RedirectResult = {
  status: number;
  headers: Record<string, string | number>;
};

type JsonResult = {
  status: number;
  body: any;
};

function request(method = 'GET', headers: Record<string, string> = {}): any {
  const req = Readable.from([]) as any;
  req.method = method;
  req.headers = { host: 'localhost:5173', ...headers };
  return req;
}

function redirectResponse(): any & { result: () => RedirectResult } {
  let status = 200;
  let headers: Record<string, string | number> = {};
  return {
    writeHead(nextStatus: number, nextHeaders: Record<string, string | number>) {
      status = nextStatus;
      headers = nextHeaders;
    },
    end() {},
    result() {
      return { status, headers };
    }
  };
}

function jsonResponse(): any & { result: () => JsonResult } {
  let status = 200;
  let payload = '';
  return {
    writeHead(nextStatus: number) {
      status = nextStatus;
    },
    end(nextPayload: string) {
      payload = nextPayload;
    },
    result() {
      return { status, body: JSON.parse(payload) };
    }
  };
}

async function setup(options: { tokenStatus?: number; tokenPayload?: Record<string, unknown> } = {}) {
  vi.resetModules();
  const root = mkdtempSync(join(tmpdir(), 'murph-google-oauth-route-'));
  process.env.MURPH_CONFIG_PATH = join(root, 'config.yaml');
  process.env.MURPH_SQLITE_PATH = join(root, 'murph.sqlite');
  process.env.MURPH_CREDENTIALS_PATH = join(root, '.credentials');
  process.env.MURPH_DISTRIBUTION = 'personal';
  delete process.env.MURPH_ENCRYPTION_KEY;
  process.env.GOOGLE_CLIENT_ID = 'google-client-id';
  process.env.GOOGLE_CLIENT_SECRET = 'google-client-secret';
  process.env.OPENAI_API_KEY = 'sk-test';

  const tokenRequests: URLSearchParams[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url, init) => {
    const target = String(url);
    if (target.includes('oauth2.googleapis.com/token')) {
      tokenRequests.push(new URLSearchParams(String(init?.body ?? '')));
      return Response.json(options.tokenPayload ?? {
        access_token: 'access-token',
        refresh_token: 'refresh-token',
        expires_in: 3600,
        scope: 'gmail calendar',
        token_type: 'Bearer'
      }, { status: options.tokenStatus ?? 200 });
    }
    if (target.includes('googleapis.com/oauth2/v1/userinfo')) {
      return Response.json({ email: 'person@example.com' });
    }
    return Response.json({});
  }));

  const { getStore } = await import('#shared/server/persistence/store');
  const store = getStore();
  const workspace = store.saveInstall({
    provider: 'slack',
    externalWorkspaceId: 'T1',
    name: 'Test Workspace',
    botUserId: 'UTZBOT'
  });
  const { googleRoutes } = await import('../../shared/server/routes/google');
  const { dispatchRoute } = await import('../../shared/server/router');

  async function install(pathname: string, headers: Record<string, string> = {}) {
    const res = redirectResponse();
    await dispatchRoute(googleRoutes, {
      req: request('GET', headers),
      res,
      url: new URL(pathname, 'http://localhost:5173')
    });
    return res.result();
  }

  async function callback(pathname: string, headers: Record<string, string> = {}) {
    const res = redirectResponse();
    await dispatchRoute(googleRoutes, {
      req: request('GET', headers),
      res,
      url: new URL(pathname, 'http://localhost:5173')
    });
    return res.result();
  }

  async function integrationStatus(pathname: string) {
    const { integrationRoutes } = await import('../../shared/server/routes/integrations');
    const res = jsonResponse();
    await dispatchRoute(integrationRoutes, {
      req: request(),
      res,
      url: new URL(pathname, 'http://localhost:5173')
    });
    return res.result();
  }

  return { callback, install, integrationStatus, root, store, tokenRequests, workspace };
}

describe('Google OAuth callback route', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    delete process.env.MURPH_CONFIG_PATH;
    delete process.env.MURPH_SQLITE_PATH;
    delete process.env.MURPH_CREDENTIALS_PATH;
    delete process.env.MURPH_ENCRYPTION_KEY;
    delete process.env.MURPH_DISTRIBUTION;
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
    delete process.env.OPENAI_API_KEY;
  });

  it('builds Google install URLs from the forwarded request host', async () => {
    const { install, workspace } = await setup();

    const result = await install(`/api/google/install?workspaceId=${encodeURIComponent(workspace.id)}`, {
      'x-forwarded-host': 'murph.example.com',
      'x-forwarded-proto': 'https'
    });

    expect(result.status).toBe(302);
    const location = new URL(String(result.headers.location));
    expect(location.searchParams.get('redirect_uri')).toBe('https://murph.example.com/api/google/oauth/callback');
  });

  it('stores the OAuth bundle and reports Google connected without an encryption key', async () => {
    const { callback, integrationStatus, tokenRequests, workspace } = await setup();

    const result = await callback(`/api/google/oauth/callback?code=abc&state=${encodeURIComponent(workspace.id)}`, {
      'x-forwarded-host': 'murph.example.com',
      'x-forwarded-proto': 'https'
    });

    expect(result.status).toBe(302);
    expect(result.headers.location).toBe(`/settings?google=connected&workspaceId=${encodeURIComponent(workspace.id)}`);
    expect(process.env.MURPH_ENCRYPTION_KEY).toBeUndefined();
    expect(tokenRequests[0].get('redirect_uri')).toBe('https://murph.example.com/api/google/oauth/callback');

    const { readSecretRecord } = await import('#shared/server/credentials/local-store');
    const stored = readSecretRecord('google', 'oauth_bundle');
    expect(stored).toEqual(expect.objectContaining({
      provider: 'google',
      key: 'oauth_bundle',
      metadata: expect.objectContaining({
        account: 'person@example.com'
      })
    }));

    const status = await integrationStatus(`/api/integrations/status?workspaceId=${encodeURIComponent(workspace.id)}`);
    const google = status.body.integrations.find((integration: any) => integration.provider === 'google');
    expect(status.status).toBe(200);
    expect(google).toEqual(expect.objectContaining({
      provider: 'google',
      status: 'connected',
      source: 'credentials',
      metadata: expect.objectContaining({
        account: 'person@example.com',
        oauthConfigured: true
      })
    }));
  });

  it('redirects Google OAuth denial details without storing credentials', async () => {
    const { callback } = await setup();

    const result = await callback('/api/google/oauth/callback?error=access_denied&error_description=Denied');

    expect(result.status).toBe(302);
    expect(result.headers.location).toBe('/settings?error=Denied');
    const { readSecretRecord } = await import('#shared/server/credentials/local-store');
    expect(readSecretRecord('google', 'oauth_bundle')).toBeUndefined();
  });

  it('redirects token exchange failures without storing credentials', async () => {
    const { callback, workspace } = await setup({
      tokenStatus: 400,
      tokenPayload: { error: 'invalid_grant', error_description: 'Bad code' }
    });

    const result = await callback(`/api/google/oauth/callback?code=bad&state=${encodeURIComponent(workspace.id)}`);

    expect(result.status).toBe(302);
    expect(result.headers.location).toBe('/settings?error=Bad%20code');
    const { readSecretRecord } = await import('#shared/server/credentials/local-store');
    expect(readSecretRecord('google', 'oauth_bundle')).toBeUndefined();
  });
});
