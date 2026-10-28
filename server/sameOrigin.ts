/**
 * No other website drives this server (B-74, SRVINFRA-07; D-081).
 *
 * The Mac app's sidecar and the Electron build require the per-launch token (`apiToken.ts`). A browser page served by
 * `npm run dev` or `npm start` cannot hold one, so the server refuses what only another site would send instead:
 *
 * - a request the browser marks as coming from another origin (`Sec-Fetch-Site` other than `same-origin` or `none`);
 * - a request whose `Origin` is not this server's own (the scheme, the host and the port the request was addressed to);
 * - a write (POST, PUT, PATCH, DELETE) whose body is not JSON (`requestBody.ts`): a page on another site can send a
 *   `text/plain` or form body without asking first, but a JSON body makes the browser ask (a preflight), and this server
 *   never grants one.
 *
 * Programs that are not browsers send neither header (the Mac app, the server's own self-calls, curl) and are answered
 * as before: what keeps them out is the token where there is one, and the loopback bind. Applied in every mode, so the
 * token modes get the same refusal as well.
 */
import type { NextFunction, Request, Response } from 'express';

export const OTHER_SITE_REFUSED = 'This server only answers Pennant\'s own pages.';

/** The browser's own word on where a request came from: these two are this origin, or the person typing the address. */
const OWN_SITE = new Set(['same-origin', 'none']);

/** Whether `origin` is this request's own: the same scheme, host and port it was addressed to. */
function ownOrigin(origin: string, req: Request): boolean {
  const host = req.headers.host;
  if (!host) return false;
  return origin === `http://${host}` || origin === `https://${host}`;
}

export function refuseOtherSites(req: Request, res: Response, next: NextFunction): void {
  const site = req.headers['sec-fetch-site'];
  const origin = req.headers.origin;
  const fromAnotherSite = (typeof site === 'string' && !OWN_SITE.has(site.toLowerCase()))
    || (typeof origin === 'string' && !ownOrigin(origin, req));
  if (!fromAnotherSite) return next();
  console.warn(`[api] ${req.method} ${req.path}: refused a request from another site`);
  res.status(403).json({ error: OTHER_SITE_REFUSED });
}
