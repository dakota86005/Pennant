/**
 * The snapshots an import leaves in `history.db` (N3.5): the rating snapshot (development tracking), stamped with the
 * export's rating mode (D-061), the roster-state snapshot (a fallback beside the export and the live log, never a
 * source of transactions) and the market and contracts (Player Value, PLAYER_VALUE.md Part 7). Each is idempotent for
 * its save and game date, and none can fail an import.
 *
 * They read the whole league (2.3 s on a real export, N3.5 Stage A), so they run in a worker thread after the swap
 * (`snapshotsInWorker`), and on the server's thread only when a worker cannot start (the tests, an unusual packaging),
 * one at a time with a breath between them.
 */
import { Worker } from 'node:worker_threads';
import { stampSnapshotMode, takeSnapshot } from './history.js';
import { captureRosterStateSnapshot } from './rosterStateHistory.js';
import { resetTransactionLogCache } from './dataStatus.js';
import { captureMarketSnapshot } from './playerValueSnapshot.js';
import type { RatingModeRecord } from './ratingMode.js';

export interface SnapshotRequest {
  /** When the import finished (the market snapshot's key). */
  importFinishedAt: string | null;
  /** When it started (the rating-mode stamp names its import). */
  importStartedAt: string | null;
  ratingMode: RatingModeRecord | null;
}

export interface SnapshotOutcome {
  ratings: { gameDate: string; players: number } | null;
  errors: string[];
}

const breathe = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

/** Takes the three snapshots here, one at a time; `breathe` between them when on the server's thread. */
export async function takeImportSnapshots(request: SnapshotRequest, between: () => Promise<void> = breathe): Promise<SnapshotOutcome> {
  const errors: string[] = [];
  let ratings: SnapshotOutcome['ratings'] = null;
  try {
    // An export carrying no ratings ("Show no player ratings") gives no rating snapshot: its rating columns hold nothing
    // to observe (D-018), whatever OOTP wrote in them
    if (request.ratingMode?.mode !== 'none') {
      ratings = takeSnapshot(); // development-tracking snapshot, keyed by in-game date
      if (ratings) stampSnapshotMode(ratings.gameDate, request.ratingMode, request.importStartedAt);
    }
  } catch (err) {
    errors.push(`rating snapshot: ${(err as Error).message}`);
  }
  await between();
  try {
    // Roster-state observation: a fallback and cross-check beside the CSV and the live transaction log, never a
    // source of transactions itself. The live log is re-read first so the cross-check sees what OOTP has written
    resetTransactionLogCache();
    captureRosterStateSnapshot();
  } catch (err) {
    errors.push(`roster-state snapshot: ${(err as Error).message}`);
  }
  await between();
  try {
    const market = captureMarketSnapshot({ importFinishedAt: request.importFinishedAt });
    if (market.error) errors.push(`market snapshot: ${market.error}`);
    if (market.contracts.error) errors.push(`contract snapshot: ${market.contracts.error}`);
  } catch (err) {
    errors.push(`market snapshot: ${(err as Error).message}`);
  }
  return { ratings, errors };
}

/** The worker's entry: the bundled builds ship it beside the bundle; the source runs it through tsx. */
function snapshotWorkerUrl(): URL {
  const here = new URL(import.meta.url);
  return here.pathname.endsWith('.cjs') ? new URL('./snapshot-worker.cjs', here) : new URL('./snapshotWorker.ts', here);
}

/** The snapshots in a worker thread; rejects when the worker cannot start or fails. */
export function snapshotsInWorker(request: SnapshotRequest): Promise<SnapshotOutcome> {
  return new Promise((resolve, reject) => {
    let worker: Worker;
    try {
      worker = new Worker(snapshotWorkerUrl(), { workerData: request });
    } catch (err) {
      reject(err);
      return;
    }
    let settled = false;
    worker.once('message', (m: { ok: boolean; outcome?: SnapshotOutcome; error?: string }) => {
      settled = true;
      if (m.ok && m.outcome) resolve(m.outcome);
      else reject(new Error(m.error ?? 'the snapshot worker failed'));
      void worker.terminate();
    });
    worker.once('error', (err) => { if (!settled) { settled = true; reject(err); } });
    worker.once('exit', (code) => { if (!settled) { settled = true; reject(new Error(`the snapshot worker exited with ${code}`)); } });
  });
}

/** The snapshots, in a worker where one starts, else here with breaths between them. Never rejects. */
export async function snapshotsAfterImport(request: SnapshotRequest): Promise<SnapshotOutcome> {
  try {
    return await snapshotsInWorker(request);
  } catch (err) {
    console.warn('[history] snapshot worker unavailable, taking the snapshots on the server\'s thread:', (err as Error).message);
    try {
      return await takeImportSnapshots(request);
    } catch (e) {
      return { ratings: null, errors: [(e as Error).message] };
    }
  }
}
