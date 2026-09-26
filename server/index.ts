import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { api, recordImportMarket, recoverInterruptedImport, refitAfterImport, runImport } from './api.js';
import { buildIndexes } from './importer.js';
import { APP_ROOT, DATA_DIR, loadConfig } from './config.js';
import { startWatcher, stopWatcher } from './watcher.js';
import { db, tableExists } from './db.js';
import { historyDb, snapshotDates, takeSnapshot } from './history.js';
import { loadSettings } from './settings.js';
import { requireApiToken } from './apiToken.js';
import { acquireDataLock, releaseDataLock } from './dataLock.js';

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
 * not the port, so the Vite dev proxy (which forwards the original
 * `localhost:5173`) keeps working.
 */
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1', '0.0.0.0']);

/** Where to listen. Loopback unless the user deliberately opens it up. */
export const BIND_ADDRESS = process.env.OOTP_FO_BIND?.trim() || '127.0.0.1';
// Note 0.0.0.0 is a valid Host header but is NOT a loopback bind — it means
// every interface, which is exactly the case that opens the server up.
const LOOPBACK_BINDS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);
const OPEN_TO_NETWORK = !LOOPBACK_BINDS.has(BIND_ADDRESS.toLowerCase());

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

function requireLocalHost(
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

/** Import on boot if needed, then watch for fresh OOTP exports. */
function bootstrapData(): void {
  // An import the last run never finished left a database that is neither export: import it again, which also
  // refits and records the market once it is done (api.ts). Nothing else below needs doing until then.
  if (recoverInterruptedImport()) {
    const { csvDir } = loadConfig();
    if (csvDir && loadSettings().autoImport) startWatcher(csvDir);
    return;
  }
  // A save that is already imported but has no fit for its latest completed season gets one now,
  // in the background, instead of waiting for the next import (D-053: nothing for the user to do).
  // It reads only the imported database, so it does not depend on the export folder being present.
  // Deferred with setImmediate, so it runs after the synchronous start-up below (indexes included).
  if (tableExists('players')) refitAfterImport();
  // The export already imported records its market and contracts if this build has not yet (idempotent: a second
  // start writes nothing). Deferred like the refit, after the synchronous start-up below
  if (tableExists('players')) setImmediate(() => recordImportMarket());
  const config = loadConfig();
  if (!config.csvDir || !fs.existsSync(config.csvDir)) return;
  if (!tableExists('players')) void runImport(config.csvDir);
  // Indexes used to be built only by the importer, so upgrading the app left
  // every existing database without them — the same full table scans as before,
  // and an export that took twenty-five minutes with the UI wedged behind it.
  // Creating them is idempotent and only costs anything the first time.
  buildIndexes();
  if (loadSettings().autoImport) startWatcher(config.csvDir);
  try {
    // Ensure development tracking has a baseline for already-imported data
    if (tableExists('players') && snapshotDates().length === 0) takeSnapshot();
  } catch (err) {
    console.error('[history] baseline snapshot failed:', err);
  }
}

/**
 * The port `PORT` asks for. `0` is a real request (any free port), which `Number(PORT) || 5178` used to turn
 * back into 5178; only a missing or malformed value falls back.
 */
export function portFromEnv(value: string | undefined, fallback = 5178): number {
  const trimmed = value?.trim();
  if (!trimmed || !/^\d+$/.test(trimmed)) return fallback;
  const port = Number(trimmed);
  return port <= 65_535 ? port : fallback;
}

/** Which program is running this server, for the data-folder lock's refusal message. */
function lockLabel(): string {
  if (process.env.OOTP_FO_SIDECAR === '1') return 'Pennant for Mac';
  if (process.versions.electron) return 'Pennant (Electron)';
  return 'the development server';
}

let httpServer: Server | null = null;

/**
 * Starts the API (and, when built, the frontend) and resolves with the port.
 * Pass port 0 to let the OS pick a free one — the desktop app does this so it
 * never collides with another copy or an unrelated service.
 *
 * Takes the data-folder lock first (`dataLock.ts`) and rejects with
 * `DataFolderLocked` when another copy of Pennant is using the folder.
 */
export function startServer(port = 5178): Promise<number> {
  try {
    acquireDataLock(DATA_DIR, lockLabel());
  } catch (err) {
    return Promise.reject(err);
  }
  const app = express();
  app.use(requireLocalHost);
  app.use(express.json());
  // After the Host check: a request that fails both is told about the Host. No-op unless a token is set (sidecar)
  app.use('/api', requireApiToken);
  app.use('/api', api);

  const dist = path.join(APP_ROOT, 'dist');
  if (fs.existsSync(dist)) {
    app.use(express.static(dist));
    app.get('*', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
  }

  return new Promise((resolve, reject) => {
    const server = app.listen(port, BIND_ADDRESS);
    server.once('error', reject);
    server.once('listening', () => {
      httpServer = server;
      const actual = (server.address() as AddressInfo).port;
      // The chat tools read the app's own endpoints so the assistant sees
      // exactly what the UI shows, rather than a second implementation.
      process.env.OOTP_FO_PORT = String(actual);
      console.log(`[server] http://localhost:${actual}`);
      if (OPEN_TO_NETWORK) {
        const lan = Object.values(os.networkInterfaces())
          .flatMap((addrs) => addrs ?? [])
          .filter((a) => a.family === 'IPv4' && !a.internal)
          .map((a) => `http://${a.address}:${actual}`);
        console.warn(
          `[server] listening on ${BIND_ADDRESS} — reachable from your network at ${lan.join(', ') || 'this machine'}`
        );
        console.warn(
          '[server] THERE IS NO PASSWORD. Anyone who can reach this address can read the whole ' +
            'save, change settings, and spend your Anthropic credits through the assistant. ' +
            'Only do this on a network you trust, and never forward the port from a router.'
        );
      }
      bootstrapData();
      resolve(actual);
    });
  });
}

/**
 * Stops cleanly (the sidecar's SIGTERM and stdin close): stops listening and drops open connections (event streams
 * would otherwise hold the close open forever), stops the export watcher, closes both databases and releases the
 * data-folder lock. An import still running is abandoned; its marker stays, and the next start imports again.
 */
export async function shutdownServer(): Promise<void> {
  const server = httpServer;
  httpServer = null;
  if (server) {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
      server.closeAllConnections();
    });
  }
  stopWatcher();
  for (const [name, handle] of [['league', db], ['history', historyDb]] as const) {
    try {
      if (handle.open) handle.close();
    } catch (err) {
      console.error(`[server] closing the ${name} database failed:`, err);
    }
  }
  releaseDataLock();
}

// Running directly (npm run dev / npm start) rather than embedded in Electron or the Mac sidecar
if (!process.env.OOTP_FO_EMBEDDED) {
  startServer(portFromEnv(process.env.PORT)).catch((err) => {
    console.error('[server] failed to start:', err);
    process.exit(1);
  });
}
