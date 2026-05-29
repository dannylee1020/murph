import { describe, expect, it } from 'vitest';

describe('runtime route composition', () => {
  it('keeps subscriber control plane routes in the team distribution', async () => {
    const { teamRoutes } = await import('../app/team/runtime/routes');
    const paths = teamRoutes().map((route) => route.path);

    expect(paths).toContain('/api/me/bootstrap');
    expect(paths).toContain('/api/gateway/subscriptions');
    expect(paths).toContain('/api/gateway/subscriptions/:userId/dashboard-link');
  });

  it('removes subscriber control plane routes from the personal distribution', async () => {
    const { personalRoutes } = await import('../app/personal/runtime/routes');
    const paths = personalRoutes().map((route) => route.path);

    expect(paths.some((path) => path.startsWith('/api/me/'))).toBe(false);
    expect(paths).not.toContain('/api/gateway/subscriptions');
    expect(paths).not.toContain('/api/gateway/subscriptions/:userId');
    expect(paths).not.toContain('/api/gateway/subscriptions/:userId/dashboard-link');
  });
});
