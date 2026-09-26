import type { Router } from 'express';
import { api } from '../server/api.js';

/**
 * Every route a router registers, walked from Express's own stack: the method in capitals and the full path relative
 * to where the router is mounted (`/api` for the API router), a sub-router's mount path included, so a route on
 * `api.use('/v2', router)` is walked as `/v2/...`. Shared by the duplicate-path check (`routes.test.ts`) and the
 * contract's coverage check (`contract.test.ts`).
 *
 * Express 4 keeps no mount path on a layer, only the regular expression it built from it; a plain prefix
 * (`/v2`, `/v2/front-office`) is read back from that. A prefix with a parameter or a pattern cannot be read back, so
 * the walk throws rather than report its routes under the wrong path.
 */
interface Layer {
  route?: { path: string; methods: Record<string, boolean> };
  handle?: { stack?: Layer[] };
  regexp?: RegExp & { fast_slash?: boolean };
}

export interface RegisteredRoute {
  method: string;
  path: string;
}

/** The static path a router layer is mounted at ('' for the root). */
export function mountPath(layer: Layer): string {
  const regexp = layer.regexp;
  if (!regexp || regexp.fast_slash) return '';
  // Express 4 builds `/^\/v2\/?(?=\/|$)/i` from `use('/v2', router)`
  const inner = /^\^(.*)\\\/\?\(\?=\\\/\|\$\)$/.exec(regexp.source)?.[1];
  if (inner === undefined || !/^(?:\\\/[A-Za-z0-9._~-]+)+$/.test(inner)) {
    throw new Error(`A router is mounted at ${String(regexp)}: the route walk reads only a plain path prefix; mount it at a plain path`);
  }
  return inner.replace(/\\\//g, '/');
}

export function registeredRoutes(router: Router = api): RegisteredRoute[] {
  const found: RegisteredRoute[] = [];
  const walk = (stack: Layer[] | undefined, prefix: string): void => {
    for (const layer of stack ?? []) {
      if (layer.route) {
        for (const method of Object.keys(layer.route.methods)) {
          found.push({ method: method.toUpperCase(), path: `${prefix}${layer.route.path}` });
        }
      } else if (layer.handle?.stack) {
        walk(layer.handle.stack, `${prefix}${mountPath(layer)}`);
      }
    }
  };
  walk((router as unknown as { stack: Layer[] }).stack, '');
  return found;
}
