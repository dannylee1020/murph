import { beforeEach, describe, expect, it, vi } from 'vitest';

function redirectResponse(): any & { result: () => { status: number; location?: string } } {
  let status = 200;
  let location: string | undefined;
  return {
    writeHead(nextStatus: number, headers: Record<string, string>) {
      status = nextStatus;
      location = headers.location;
    },
    end() {},
    result() {
      return { status, location };
    }
  };
}

describe('discord routes', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.DISCORD_CLIENT_ID = 'client-id';
    process.env.DISCORD_CLIENT_SECRET = 'client-secret';
    process.env.DISCORD_REDIRECT_URI = 'http://localhost:5173/api/discord/oauth/callback';
    process.env.DISCORD_BOT_TOKEN = 'bot-token';
  });

  it('redirects install requests to the Discord OAuth URL', async () => {
    const { discordRoutes } = await import('../../src/server/routes/discord');
    const { dispatchRoute } = await import('../../src/server/router');
    const res = redirectResponse();

    await dispatchRoute(discordRoutes, {
      req: { method: 'GET', headers: {} } as any,
      res,
      url: new URL('/api/discord/install', 'http://localhost')
    });

    const result = res.result();
    expect(result.status).toBe(302);
    expect(result.location).toContain('discord.com/oauth2/authorize');
  });
});
