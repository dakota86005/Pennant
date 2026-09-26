import { api } from '../server/api.js';

/**
 * Every route the API router registers, walked from Express's own stack (so a route mounted through a sub-router is
 * found as well): the method in capitals and the path relative to `/api`. Shared by the duplicate-path check
 * (`routes.test.ts`) and the contract's coverage check (`contract.test.ts`).
 */
interface Layer {
  route?: { path: string; methods: Record<string, boolean> };
  handle?: { stack?: Layer[] };
}

export interface RegisteredRoute {
  method: string;
  path: string;
}

export function registeredRoutes(): RegisteredRoute[] {
  const found: RegisteredRoute[] = [];
  const walk = (stack: Layer[] | undefined): void => {
    for (const layer of stack ?? []) {
      if (layer.route) {
        for (const method of Object.keys(layer.route.methods)) found.push({ method: method.toUpperCase(), path: layer.route.path });
      } else if (layer.handle?.stack) {
        walk(layer.handle.stack);
      }
    }
  };
  walk((api as unknown as { stack: Layer[] }).stack);
  return found;
}
