import { describe, expect, it } from 'vitest';

describe('runtime route composition', () => {
  it('does not expose subscriber control plane routes in the team distribution', async () => {
    const { murphRoutes } = await import('../murph/runtime/routes');
    const paths = murphRoutes().map((route) => route.path);

    expect(paths.some((path) => path.startsWith('/api/me/'))).toBe(false);
    expect(paths).not.toContain('/api/gateway/subscriptions');
    expect(paths).not.toContain('/api/gateway/subscriptions/:userId/dashboard-link');
  });

});
