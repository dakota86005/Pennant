import { describe, expect, it } from 'vitest';
import { registeredRoutes } from './apiRoutes';

/**
 * Two routers registering the same path is a silent fault: Express hands every
 * request to whichever mounted first, and the loser's page simply receives the
 * wrong shape and renders blank. It has happened twice — /schedule/:teamId and
 * /staff/:orgId — and neither showed up as an error anywhere, which is exactly
 * why it needs a test rather than vigilance.
 */

describe('the API router', () => {
  it('registers each path exactly once', () => {
    const routes = registeredRoutes().map((r) => `${r.method} ${r.path}`);
    const seen = new Map<string, number>();
    for (const r of routes) seen.set(r, (seen.get(r) ?? 0) + 1);
    const duplicates = [...seen.entries()].filter(([, n]) => n > 1).map(([r]) => r);
    expect(duplicates).toEqual([]);
  });

  it('found routes at all, so the check cannot pass vacuously', () => {
    expect(registeredRoutes().length).toBeGreaterThan(20);
  });
});
