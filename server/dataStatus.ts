/**
 * What Pennant currently knows about the OOTP save, and how current it is.
 *
 * Ties together save discovery, the safe live-log reader, and the freshness
 * model. This is what the UI's data-status area and the diagnostics endpoint
 * report, and what player-level transaction context reads its log from.
 *
 * Normal operation needs nothing from the user beyond the CSV export they
 * already make: the save is derived from the export's location, and the live
 * transaction database from the save.
 */

import fs from 'node:fs';
import { db, tableColumns, tableExists } from './db.js';
import { loadConfig } from './config.js';
import {
  locateSave, readLastDateSimulated,
  type LiveDatabaseFiles, type SaveDiscoveryMethod, type SaveLocation,
} from './ootpSave.js';
import { Worker } from 'node:worker_threads';
import { LiveLogError, type LiveLogFailure, type SnapshotMeta } from './liveLogSnapshot.js';
import { readTransactionLog, type LogCoverage, type TransactionKind, type TransactionLog } from './transactionLog.js';
import type { LogAvailability } from './assignmentContext.js';
import {
  assessFreshness, parseGameDate,
  type FreshnessAssessment, type GameDate, type LogUnavailableReason, type SourceState,
} from './dataFreshness.js';
import type { Integer } from './contract/primitives.js';
import { currentRatingMode } from './history.js';
import { ourScoutsRatings, type OurScoutsRatings } from './scoutedEvidence.js';
import { historyNote } from './historyIdentity.js';
import { leftOutOfServedImport, upgradeState, type LeftOutFile } from './importer.js';
import type { RatingModeRecord } from './ratingMode.js';

export interface LogSourceStatus {
  /** The live transaction database exists in the save's temp folder. */
  found: boolean;
  readable: boolean;
  error: { code: LiveLogFailure | 'missing'; message: string } | null;
  unavailableReason: LogUnavailableReason | null;
  files: { db: boolean; wal: boolean; shm: boolean } | null;
  snapshot: SnapshotMeta | null;
  coverage: LogCoverage | null;
  counts: { events: Integer; unsupported: Integer; byKind: Partial<Record<TransactionKind, Integer>> } | null;
  unsupportedSamples: string[];
}

export interface DataStatus {
  generatedAt: string;
  configured: boolean;
  save: {
    found: boolean;
    name: string | null;
    /** Diagnostic: where the `.lg` was found. Not something the user has to supply. */
    lgPath: string | null;
    discovery: SaveDiscoveryMethod;
    discoveryNotes: string[];
    /** Last simulated in-game date (ISO), from the save itself. */
    simulatedThrough: GameDate | null;
    dateSource: string | null;
  };
  csv: {
    /** `leagues.current_date` of the imported export (ISO): the day about to be played. */
    currentDate: GameDate | null;
    /** The last day the imported data reflects. */
    simulatedThrough: GameDate | null;
    exportedAt: string | null;
    importedAt: string | null;
  };
  transactionLog: LogSourceStatus;
  freshness: FreshnessAssessment;
  /** What the imported export carries and what its import left out (N3.5, D-061). */
  import: {
    /** Which kind of ratings the export carries, as the import read OOTP's export settings; null for an import from before N3.5. */
    ratingMode: RatingModeRecord | null;
    /**
     * Our scouts' full reports, when the export carries them for our club and they are the scouted evidence (D-067): our
     * club's id and how many players they rate; null otherwise (the main tables are the evidence, of `ratingMode`'s kind).
     */
    ourScouts: OurScoutsRatings | null;
    /** Files the import left out (older than the rest of the export, or unreadable), and what their tables hold. */
    leftOut: LeftOutFile[];
    /**
     * Why the one-time upgrade of an earlier build's league database did not run at this start, in a sentence (not
     * enough free space; the league is served as it is and it is tried again at the next start); null otherwise.
     */
    upgradeNote: string | null;
  };
  /**
   * This save's rating history (D-064): a sentence when some of it is not used (history filed under the save's name
   * before it had a key of its own that couldn't be matched to it for sure) or when it started fresh; null when all of
   * it is this save's. `because` is the basis: what became of each part, and why the history began where it did.
   */
  history: {
    note: string | null;
    because: string[];
  };
}

interface Cached {
  key: string;
  /** The save the log was read from: a stale copy is served only for the same save. */
  lgPath: string | null;
  at: number;
  log: TransactionLog | null;
  status: LogSourceStatus;
}

let cache: Cached | null = null;
/** A failed read of an unchanged source is not retried every poll. */
const FAILURE_TTL_MS = 15_000;

/**
 * How the live log is read again after OOTP writes it (N3.5 Stage B2): never on a request's path. A request that finds
 * the log changed is served the last copy at once, and a read is scheduled `debounceMs` after the last change it saw
 * (OOTP writes the log many times while it plays), but no later than `maxWaitMs` after the first, in a worker thread
 * where one can start. The same as the Front Office's cache: the page never waits, the copy follows within seconds.
 */
export const logRefreshTiming = { debounceMs: 2_000, maxWaitMs: 10_000 };

/** Bumped by every reset, so a background read begun before one is never kept after it. */
let generation = 0;
let pending: { timer: ReturnType<typeof setTimeout>; firstSeen: number; lgPath: string | null } | null = null;
let reading: Promise<void> | null = null;

/** Forgets the log entirely (a different save, a hand-named save folder): the next request reads it afresh. */
export function resetTransactionLogCache(): void {
  cache = null;
  generation += 1;
  if (pending) clearTimeout(pending.timer);
  pending = null;
}

const statKey = (file: string): string => {
  try {
    const st = fs.statSync(file);
    return `${st.size}:${st.mtimeMs}`;
  } catch {
    return 'absent';
  }
};

const emptyLogStatus = (over: Partial<LogSourceStatus>): LogSourceStatus => ({
  found: false, readable: false, error: null, unavailableReason: null, files: null,
  snapshot: null, coverage: null, counts: null, unsupportedSamples: [], ...over,
});

/** Where the current save lives, derived from configuration. */
export function currentSaveLocation(): SaveLocation {
  const config = loadConfig();
  return locateSave({ csvDir: config.csvDir, saveName: config.saveName, manualLgPath: config.lgPath ?? null });
}

const logKey = (location: SaveLocation): string =>
  [location.lgPath, statKey(location.live!.db), statKey(location.live!.wal)].join('|');

const filesOf = (live: LiveDatabaseFiles) => ({ db: live.dbExists, wal: live.walExists, shm: live.shmExists });

/** What a read gave, as the cache keeps it. */
function outcome(location: SaveLocation, key: string, read: { log: TransactionLog } | { code: LiveLogFailure | null; message: string }): Cached {
  const files = filesOf(location.live!);
  if ('log' in read) {
    const log = read.log;
    return {
      key, lgPath: location.lgPath, at: Date.now(), log,
      status: {
        found: true, readable: true, error: null, unavailableReason: null, files,
        snapshot: log.snapshot, coverage: log.coverage,
        counts: { events: log.counts.events, unsupported: log.counts.unsupported, byKind: log.counts.byKind },
        unsupportedSamples: log.unsupportedSamples,
      },
    };
  }
  return {
    key, lgPath: location.lgPath, at: Date.now(), log: null,
    status: emptyLogStatus({
      found: true,
      files,
      unavailableReason: read.code === 'not_found' ? 'database_missing' : 'unreadable',
      error: { code: read.code ?? 'copy_failed', message: read.message },
    }),
  };
}

/** Reads the log on this thread (a first read for a save, or where no worker can start). */
function readHere(location: SaveLocation, key: string): Cached {
  try {
    return outcome(location, key, { log: readTransactionLog(location.live!) });
  } catch (err) {
    return outcome(location, key, { code: err instanceof LiveLogError ? err.code : null, message: (err as Error).message });
  }
}

/** The worker's entry: the bundled builds ship it beside the bundle; the source runs it through tsx. */
function logWorkerUrl(): URL {
  const here = new URL(import.meta.url);
  return here.pathname.endsWith('.cjs') ? new URL('./transaction-log-worker.cjs', here) : new URL('./transactionLogWorker.ts', here);
}

let workerBroken = false;
/** Whether a worker can load: the bundle always; the TypeScript sources only under tsx (a test runner has none). */
function logWorkerAvailable(): boolean {
  return !workerBroken && (logWorkerUrl().pathname.endsWith('.cjs') || process.execArgv.some((a) => a.includes('tsx')));
}

/** Reads the log in a worker thread; in-process after this turn when none can start. */
function readInBackground(location: SaveLocation, key: string): Promise<Cached> {
  if (!logWorkerAvailable()) return new Promise((resolve) => setImmediate(() => resolve(readHere(location, key))));
  return new Promise((resolve) => {
    let worker: Worker;
    try {
      worker = new Worker(logWorkerUrl(), { workerData: location.live });
    } catch (err) {
      workerBroken = true;
      console.error('[log] worker unavailable, reading in-process from now on:', err);
      setImmediate(() => resolve(readHere(location, key)));
      return;
    }
    let done = false;
    const finish = (value: Cached): void => {
      if (done) return;
      done = true;
      resolve(value);
      void worker.terminate();
    };
    worker.once('message', (m: { ok: true; log: TransactionLog } | { ok: false; code: LiveLogFailure | null; message: string }) =>
      finish(outcome(location, key, m.ok ? { log: m.log } : { code: m.code, message: m.message })));
    worker.once('error', (err) => {
      workerBroken = true;
      console.error('[log] worker failed, reading in-process from now on:', err);
      setImmediate(() => finish(readHere(location, key)));
    });
    worker.once('exit', (code) => { if (!done) setImmediate(() => finish(readHere(location, key))); void code; });
  });
}

/** Schedules the background read: `debounceMs` after the last change seen, no later than `maxWaitMs` after the first. */
function scheduleRefresh(location: SaveLocation): void {
  const now = Date.now();
  const firstSeen = pending?.lgPath === location.lgPath ? pending.firstSeen : now;
  if (pending) clearTimeout(pending.timer);
  const wait = Math.max(0, Math.min(logRefreshTiming.debounceMs, firstSeen + logRefreshTiming.maxWaitMs - now));
  const timer = setTimeout(() => {
    pending = null;
    if (reading) return; // the read in flight is followed by the next request's look
    const started = generation;
    const key = logKey(location);
    reading = readInBackground(location, key).then((read) => {
      if (started === generation) cache = read;
    }).finally(() => { reading = null; });
  }, wait);
  timer.unref?.();
  pending = { timer, firstSeen, lgPath: location.lgPath };
}

/** Resolves once no background read is scheduled or running (the tests' seam). */
export async function transactionLogSettled(): Promise<void> {
  while (pending || reading) {
    if (reading) await reading;
    else await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

/**
 * The parsed live transaction log for the current save, or the reason it is unavailable. Cached against the source
 * files' size and modification time, so asking again while OOTP has written nothing costs a few `stat` calls. When
 * OOTP has written it since the last copy, the last copy is served at once and a new one is read in the background
 * (`logRefreshTiming`): a request never waits on the copy. Only a save's first read happens on the request's path
 * (the server warms it at start, `warmTransactionLog`).
 */
export function currentTransactionLog(location: SaveLocation = currentSaveLocation()): {
  log: TransactionLog | null;
  status: LogSourceStatus;
} {
  if (!location.found || !location.live) {
    return { log: null, status: emptyLogStatus({ unavailableReason: 'save_not_found' }) };
  }
  const live = location.live;
  if (!live.dbExists) {
    return {
      log: null,
      status: emptyLogStatus({
        files: filesOf(live),
        unavailableReason: 'database_missing',
        error: { code: 'missing', message: `No ${live.db} in the save's temp folder.` },
      }),
    };
  }

  const key = logKey(location);
  if (cache && cache.key === key && (cache.log || Date.now() - cache.at < FAILURE_TTL_MS)) {
    return { log: cache.log, status: cache.status };
  }
  // The same save, written since (or a failure worth retrying): the last copy now, a new one in the background
  if (cache && cache.lgPath === location.lgPath) {
    scheduleRefresh(location);
    return { log: cache.log, status: cache.status };
  }
  cache = readHere(location, key);
  return { log: cache.log, status: cache.status };
}

/**
 * The log as last read for this save, without reading it (N7: the league wire is built from what is already copied,
 * never on a request's path): a copy OOTP has written since is read again in the background, as for a request. Null
 * while no copy of this save's log has been read yet (one is started in the background).
 */
export function peekTransactionLog(location: SaveLocation = currentSaveLocation()): { log: TransactionLog | null; status: LogSourceStatus } | null {
  if (!location.found || !location.live) return { log: null, status: emptyLogStatus({ unavailableReason: 'save_not_found' }) };
  if (!location.live.dbExists) return currentTransactionLog(location);
  if (cache && cache.lgPath === location.lgPath) {
    if (cache.key !== logKey(location)) scheduleRefresh(location);
    return { log: cache.log, status: cache.status };
  }
  warmTransactionLog();
  return null;
}

/** Reads the current save's log in the background (at start), so no request makes the first copy. */
export function warmTransactionLog(): void {
  const location = currentSaveLocation();
  if (!location.found || !location.live?.dbExists || (cache && cache.lgPath === location.lgPath)) return;
  const started = generation;
  const key = logKey(location);
  reading = readInBackground(location, key).then((read) => {
    if (started === generation && !(cache && cache.lgPath === location.lgPath)) cache = read;
  }).finally(() => { reading = null; });
}

function csvCurrentDate(): string | null {
  if (!tableExists('leagues') || !tableColumns('leagues').includes('current_date')) return null;
  const teamsOk = tableExists('teams') && tableColumns('teams').includes('level');
  try {
    const row = db
      .prepare(
        teamsOk
          ? `SELECT "current_date" AS d FROM leagues
             WHERE league_id IN (SELECT DISTINCT league_id FROM teams WHERE level = 1)
             ORDER BY league_id LIMIT 1`
          : `SELECT "current_date" AS d FROM leagues ORDER BY league_id LIMIT 1`
      )
      .get() as { d: unknown } | undefined;
    return parseGameDate(row?.d);
  } catch {
    return null;
  }
}

/** Modification time of the newest CSV file. Shown as a diagnostic, never used to judge freshness. */
export function csvExportedAt(csvDir: string): string | null {
  try {
    let latest = 0;
    for (const f of fs.readdirSync(csvDir)) {
      if (!f.endsWith('.csv')) continue;
      const mtime = fs.statSync(`${csvDir}/${f}`).mtimeMs;
      if (mtime > latest) latest = mtime;
    }
    return latest ? new Date(latest).toISOString() : null;
  } catch {
    return null;
  }
}

export function getDataStatus(opts: { importedAt?: string | null } = {}): DataStatus {
  const config = loadConfig();
  const location = currentSaveLocation();
  const simulated = readLastDateSimulated(location);
  const { status: logStatus } = currentTransactionLog(location);
  const hasData = tableExists('players') && tableExists('teams');
  const currentDate = hasData ? csvCurrentDate() : null;

  const freshness = assessFreshness({
    saveSimulatedThrough: simulated?.date ?? null,
    csvCurrentDate: currentDate,
    log: logStatus.readable && logStatus.coverage
      ? {
          available: true,
          lastTransactionDate: logStatus.coverage.lastTransactionDate,
          coveredThrough: logStatus.coverage.coveredThrough,
        }
      : { available: false, reason: logStatus.unavailableReason ?? 'save_not_found' },
  });

  return {
    generatedAt: new Date().toISOString(),
    configured: !!config.csvDir,
    save: {
      found: location.found,
      name: location.saveName ?? config.saveName,
      lgPath: location.lgPath,
      discovery: location.method,
      discoveryNotes: location.notes,
      simulatedThrough: simulated?.date ?? null,
      dateSource: simulated?.source ?? null,
    },
    csv: {
      currentDate,
      simulatedThrough: freshness.csv.through,
      exportedAt: config.csvDir ? csvExportedAt(config.csvDir) : null,
      importedAt: opts.importedAt ?? null,
    },
    transactionLog: logStatus,
    freshness,
    import: {
      ratingMode: hasData ? currentRatingMode() : null,
      ourScouts: hasData ? ourScoutsRatings() : null,
      leftOut: hasData ? leftOutOfServedImport() : [],
      upgradeNote: upgradeState.note,
    },
    history: hasData ? historyNote() : { note: null, because: [] },
  };
}

/** What assignment context needs to know about the log, taken from freshness. */
export function logAvailability(status: DataStatus = getDataStatus()): LogAvailability {
  return {
    available: status.transactionLog.readable,
    behind: status.freshness.log.state === 'behind',
  };
}

/**
 * How current the figures on a value page are, for the GM (Player Value A-20, phase 6a): the game date the export is
 * from, and one short line when he should know more. The export's own freshness against the save (D-022) is what
 * Player Rights reads to state service time and control (D-023): behind the save, those are not established; not
 * checked against the save, they are read as exported, with Player Rights' limitation. A consumer passes `state` to
 * Player Value as `currentState`, so the page and the figures agree.
 */
export interface FreshnessCue {
  /** The export's freshness against the save. */
  state: SourceState;
  /** The game date of the export (ISO): `leagues.current_date`, the day about to be played. Null when none is imported. */
  asOf: string | null;
  /** Days the export is behind the save (0 unless `behind`). */
  lagDays: number;
  /** One short visible line, or null when there is nothing to warn about. */
  line: string | null;
  /** The explanation, for a hover. */
  detail: string;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** "May 16, 2026" from an ISO date; the text as given when it is not one. */
export function gameDateWords(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}` : iso;
}

export function freshnessCue(status: DataStatus = getDataStatus()): FreshnessCue {
  const csv = status.freshness.csv;
  const asOf = csv.currentDate ?? null;
  const date = asOf ? gameDateWords(asOf) : 'an unknown date';
  const days = (n: number) => `${n} day${n === 1 ? '' : 's'}`;
  switch (csv.state) {
    case 'behind':
      return {
        state: 'behind', asOf, lagDays: csv.lagDays,
        line: `Data may be out of date: the export is ${days(csv.lagDays)} behind your save`,
        detail: `Pennant's copy of the league is from ${date}, ${days(csv.lagDays)} before the last day your OOTP save has played. ` +
          "Service time can't be read from an old export, so control, arbitration and the costs and values that depend on them " +
          'show as not known until you export the database from OOTP again and re-import it.',
      };
    case 'unverified':
      return {
        state: 'unverified', asOf, lagDays: 0,
        line: 'Not checked against your save',
        detail: `Pennant's copy of the league is from ${date}. It couldn't find your OOTP save to compare dates with, so it can't ` +
          "tell whether the export is current: service time, control and the figures built on them are read as the export states them.",
      };
    case 'unavailable':
      return { state: 'unavailable', asOf, lagDays: 0, line: 'No league data imported', detail: 'Export your OOTP database and import it to begin.' };
    default:
      return { state: 'current', asOf, lagDays: 0, line: null, detail: `Pennant's copy of the league is from ${date} and matches your OOTP save.` };
  }
}
