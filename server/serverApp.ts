/**
 * The server's request chain, built once for every mode (the Mac app's sidecar, Electron, `npm run dev`, `npm start`)
 * and for the route tests, so a test exercises exactly what production runs (B-75, SRVHEALTH-18):
 *
 * 1. the Host check (DNS rebinding);
 * 2. on `/api`, the other-site check (`sameOrigin.ts`) and the per-launch token where one is set (`apiToken.ts`);
 * 3. the JSON body, within its route's stated limit, refused in words when it can't be read (`requestBody.ts`);
 * 4. the routes.
 *
 * Nothing here reads the save; `index.ts` adds the built frontend and starts listening.
 */
import express, { type Express } from 'express';
import os from 'node:os';
import { api } from './api.js';
import { requireApiToken } from './apiToken.js';
import { readJsonBodies } from './requestBody.js';
import { refuseOtherSites } from './sameOrigin.js';
import { releaseAfterFirstAnswers } from './startupWork.js';

/**
 * Rejects requests whose Host header is not a loopback name.
 *
 * The server binds to 127.0.0.1, which stops other machines reaching it but
 * not the browser already running on this one. A page on the open web can
 * point a hostname it controls at 127.0.0.1 (DNS rebinding) and then have the
 * visitor's browser talk to this server — same-origin as far as the browser is
 * concerned, because the hostname matches. That would hand a stranger's page
 * the whole save and, worse, the ability to spend the user's API credits
 * through /api/chat.
 *
 * The defence is the Host header: a rebound request carries the attacker's
 * hostname, never `localhost` or a loopback IP. Only the hostname is checked,
 * not the port. Under `npm run dev` the request arrives through Vite's proxy,
 * which passes the page's own Host (`localhost:5173`) through because
 * `vite.config.ts` sets `changeOrigin: false`: that Host is a loopback name, and
 * it is what the other-site check (`sameOrigin.ts`) compares the browser's
 * `Origin` with. Vite's string shorthand would turn `changeOrigin` on and every
 * write from the page would be refused (`tests/devProxy.test.ts`).
 */
// `0.0.0.0` is not a loopback name (a browser can be pointed at it from any page), so it is answered only when the server
// is opened to the network and it is one of the machine's addresses (SRVINFRA-07)
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

/** Where to listen. Loopback unless the user deliberately opens it up. */
export const BIND_ADDRESS = process.env.OOTP_FO_BIND?.trim() || '127.0.0.1';
// Note 0.0.0.0 is a valid Host header but is NOT a loopback bind — it means
// every interface, which is exactly the case that opens the server up.
const LOOPBACK_BINDS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);
export const OPEN_TO_NETWORK = !LOOPBACK_BINDS.has(BIND_ADDRESS.toLowerCase());

/**
 * Host names this server will answer to.
 *
 * Serving the network does NOT mean answering to any Host. The rebinding attack
 * works by pointing a hostname the attacker owns at this machine's address, and
 * that hostname is never one of this machine's own — so the allowlist is built
 * from the real interface addresses rather than abandoned. A name that is not
 * on the list still gets a 403 even with the server bound to every interface.
 */
function allowedHosts(): Set<string> {
  const allowed = new Set(LOOPBACK_HOSTS);
  if (OPEN_TO_NETWORK) {
    for (const addrs of Object.values(os.networkInterfaces())) {
      for (const a of addrs ?? []) {
        allowed.add(a.family === 'IPv6' ? `[${a.address}]` : a.address);
        allowed.add(a.address);
      }
    }
    allowed.add(os.hostname().toLowerCase());
    // Bonjour name, which is how a Mac is usually reached on a home network
    allowed.add(`${os.hostname().replace(/\.local$/i, '').toLowerCase()}.local`);
  }
  for (const extra of (process.env.OOTP_FO_ALLOWED_HOSTS ?? '').split(',')) {
    const name = extra.trim().toLowerCase();
    if (name) allowed.add(name);
  }
  return allowed;
}
const ALLOWED_HOSTS = allowedHosts();

export function requireLocalHost(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
): void {
  const host = req.headers.host ?? '';
  // Strip the port; an IPv6 literal keeps its brackets
  const name = host.startsWith('[')
    ? host.slice(0, host.indexOf(']') + 1)
    : host.split(':')[0];
  if (ALLOWED_HOSTS.has(name.toLowerCase())) return next();
  res
    .status(403)
    .type('text/plain')
    .send(
      OPEN_TO_NETWORK
        ? `This server does not answer to the name "${name}". Add it to OOTP_FO_ALLOWED_HOSTS if it is yours.`
        : 'This server only answers requests addressed to localhost.'
    );
}

/** The request chain every mode serves, without the frontend's files. */
export function serverApp(): Express {
  const app = express();
  app.disable('x-powered-by');
  app.use(requireLocalHost);
  // Before anything is read: another site is refused, and where there is a token (the sidecar, Electron) every /api
  // request must carry it. A request that fails the Host check is told about the Host
  app.use('/api', refuseOtherSites);
  app.use('/api', requireApiToken);
  // A body that isn't JSON, or is over its route's limit, is answered in words, never with the parser's message or a
  // stack (N13 review L3)
  readJsonBodies(app);
  // The start-up's own work begins once the app's first answers are out (`startupWork.ts`)
  app.use('/api', releaseAfterFirstAnswers);
  app.use('/api', api);
  return app;
}
