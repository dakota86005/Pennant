import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { finishInterruptedPostImport, upgradeLeagueInBackground, recordImportMarket, recoverInterruptedImport, refitAfterImport, runImport } from './api.js';
import { warmFrontOffice } from './frontOfficeService.js';
import { APP_ROOT, DATA_DIR, loadConfig } from './config.js';
import { checkExport, startWatcher, stopWatcher } from './watcher.js';
import { closeLeagueDatabase, prepareLeagueDatabase, tableExists } from './db.js';
import { baselineSnapshot, historyDb } from './history.js';
import { loadSettings } from './settings.js';
import { lookAtTheServedSave, seedServedSave, startSaveWatch, stopSaveWatch } from './saveDiscovery.js';
import { afterFirstAnswers, startupWorkClock } from './startupWork.js';
import { ratingScaleMax } from './valuation.js';
import { warmTransactionLog } from './dataStatus.js';
import { acquireDataLock, releaseDataLock } from './dataLock.js';
import { BIND_ADDRESS, OPEN_TO_NETWORK, serverApp } from './serverApp.js';
import { logUnhandledRejections } from './asyncRoute.js';

/**
 * Import on boot if needed, then watch for fresh OOTP exports.
 *
 * Only what the first answers need happens before the ready line (N6 polish): the league file tidied, the served
 * save's id and the rating scale as an earlier start worked them out for this league (`servedFacts.ts`; worked out now
 * when none is remembered), and an import that must start (an interrupted one, or none yet). Everything else, in the
 * order it always ran, waits until the Mac app's first answers are out (`startupWork.ts`).
 */
function bootstrapData(): void {
  // Under the data-folder lock: a crashed import's unfinished file goes, and a database from an earlier build is
  // brought to the served shape (rollback journal, every index) once
  let needsUpgrade = false;
  try {
    needsUpgrade = prepareLeagueDatabase().needsUpgrade;
  } catch (err) {
    console.error('[import] could not tidy the league database:', err);
  }
  // What the status serves about the served save: remembered for this very league and configuration, else worked out
  // now, as before (the first start after an import or on a new build). Either way its live log is found now, before
  // the first answers, so no Front Office is built without it
  const seeded = seedServedSave();
  if (!seeded) lookAtTheServedSave();
  if (tableExists('players')) ratingScaleMax();

  // The saves on this Mac, looked at now and every minute: whether another has been played since the chosen one (D-063)
  afterFirstAnswers('look at the saves', () => startSaveWatch());
  // The save's live transaction log, copied in the background so no request makes the first copy
  afterFirstAnswers('live log', () => warmTransactionLog());
  // The imported data's save and its live log, worked out again (the status served the remembered id meanwhile)
  if (seeded) afterFirstAnswers('look at the served save', () => lookAtTheServedSave());

  // An import the last run never finished: import it again (the previous import is whole; this is a retry, and its
  // new file needs no upgrade)
  if (recoverInterruptedImport()) {
    const { csvDir } = loadConfig();
    if (csvDir && loadSettings().autoImport) startWatcher(csvDir);
    return;
  }
  const config = loadConfig();
  const exportThere = !!config.csvDir && fs.existsSync(config.csvDir);
  // Nothing imported yet: the import starts now (its progress is what the first answers say)
  if (exportThere && !tableExists('players')) void runImport(config.csvDir!);

  // A database an earlier build imported gets its one-time upgrade: a converted copy made in a worker, swapped in (never
  // in place). Begun now, so the first status says so ("Getting your league ready"); the served file stays as it is
  // meanwhile (D-061), and the first answers never wait on it
  const upgraded = needsUpgrade ? upgradeLeagueInBackground() : Promise.resolve();
  afterFirstAnswers('upkeep', () => {
    // The upkeep reads the league; on the old file (no indexes) its queries take seconds, so it waits for the upgraded one
    void upgraded.then(() => setImmediate(() => upkeep(config.csvDir, exportThere)));
  });
}

/** The start-up's upkeep once the league is in its served shape (in the order it always ran). */
function upkeep(csvDir: string | null, exportThere: boolean): void {
  // An import whose snapshots never ran takes them now (they write history.db), before the refits read them
  const finishing = finishInterruptedPostImport();
  const imported = tableExists('players') && !finishing;
  if (csvDir && exportThere) {
    try {
      // Ensure development tracking has a baseline for already-imported data, before the reports read the history
      // (none for an export that carries no ratings; stamped with the kind the export carries, N3.5)
      baselineSnapshot();
    } catch (err) {
      console.error('[history] baseline snapshot failed:', err);
    }
  }
  // The Front Office for the club the app follows, in its worker, so the first look after a launch is a cached read
  // (first of the rest: the fresh report is what the GM waits for)
  if (imported) void warmFrontOffice();
  // A save that is already imported but has no fit for its latest completed season gets one now,
  // in the background, instead of waiting for the next import (D-053: nothing for the user to do).
  // It reads only the imported database, so it does not depend on the export folder being present.
  if (imported) afterFirstAnswers('refit check', () => void refitAfterImport());
  // The export already imported records its market and contracts if this build has not yet (idempotent: a second
  // start writes nothing)
  if (imported) afterFirstAnswers('market record', () => recordImportMarket());
  if (!csvDir || !exportThere) return;
  afterFirstAnswers('export watch', () => {
    // An export written while Pennant was closed: the same judgement the watcher makes (import it, or offer it)
    if (tableExists('players')) checkExport(csvDir);
    if (loadSettings().autoImport) startWatcher(csvDir);
  });
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
  const app = serverApp();
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
      startupWorkClock();
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
  stopSaveWatch();
  closeLeagueDatabase();
  try {
    if (historyDb.open) historyDb.close();
  } catch (err) {
    console.error('[server] closing the history database failed:', err);
  }
  releaseDataLock();
}

// Running directly (npm run dev / npm start) rather than embedded in Electron or the Mac sidecar
if (!process.env.OOTP_FO_EMBEDDED) {
  logUnhandledRejections('server');
  startServer(portFromEnv(process.env.PORT)).catch((err) => {
    console.error('[server] failed to start:', err);
    process.exit(1);
  });
}
