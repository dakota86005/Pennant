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
  type SaveDiscoveryMethod, type SaveLocation,
} from './ootpSave.js';
import { LiveLogError, type LiveLogFailure, type SnapshotMeta } from './liveLogSnapshot.js';
import { readTransactionLog, type LogCoverage, type TransactionKind, type TransactionLog } from './transactionLog.js';
import type { LogAvailability } from './assignmentContext.js';
import {
  assessFreshness, parseGameDate,
  type FreshnessAssessment, type LogUnavailableReason, type SourceState,
} from './dataFreshness.js';

export interface LogSourceStatus {
  /** The live transaction database exists in the save's temp folder. */
  found: boolean;
  readable: boolean;
  error: { code: LiveLogFailure | 'missing'; message: string } | null;
  unavailableReason: LogUnavailableReason | null;
  files: { db: boolean; wal: boolean; shm: boolean } | null;
  snapshot: SnapshotMeta | null;
  coverage: LogCoverage | null;
  counts: { events: number; unsupported: number; byKind: Partial<Record<TransactionKind, number>> } | null;
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
    simulatedThrough: string | null;
    dateSource: string | null;
  };
  csv: {
    /** `leagues.current_date` of the imported export (ISO): the day about to be played. */
    currentDate: string | null;
    /** The last day the imported data reflects. */
    simulatedThrough: string | null;
    exportedAt: string | null;
    importedAt: string | null;
  };
  transactionLog: LogSourceStatus;
  freshness: FreshnessAssessment;
}

interface Cached {
  key: string;
  at: number;
  log: TransactionLog | null;
  status: LogSourceStatus;
}

let cache: Cached | null = null;
/** A failed read of an unchanged source is not retried every poll. */
const FAILURE_TTL_MS = 15_000;

export function resetTransactionLogCache(): void {
  cache = null;
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

/**
 * The parsed live transaction log for the current save, or the reason it is
 * unavailable. Cached against the source files' size and modification time, so
 * asking again while OOTP has written nothing costs a few `stat` calls.
 */
export function currentTransactionLog(location: SaveLocation = currentSaveLocation()): {
  log: TransactionLog | null;
  status: LogSourceStatus;
} {
  if (!location.found || !location.live) {
    return { log: null, status: emptyLogStatus({ unavailableReason: 'save_not_found' }) };
  }
  const live = location.live;
  const files = { db: live.dbExists, wal: live.walExists, shm: live.shmExists };
  if (!live.dbExists) {
    return {
      log: null,
      status: emptyLogStatus({
        files,
        unavailableReason: 'database_missing',
        error: { code: 'missing', message: `No ${live.db} in the save's temp folder.` },
      }),
    };
  }

  const key = [location.lgPath, statKey(live.db), statKey(live.wal)].join('|');
  if (cache && cache.key === key && (cache.log || Date.now() - cache.at < FAILURE_TTL_MS)) {
    return { log: cache.log, status: cache.status };
  }

  try {
    const log = readTransactionLog(live);
    const status: LogSourceStatus = {
      found: true, readable: true, error: null, unavailableReason: null, files,
      snapshot: log.snapshot, coverage: log.coverage,
      counts: { events: log.counts.events, unsupported: log.counts.unsupported, byKind: log.counts.byKind },
      unsupportedSamples: log.unsupportedSamples,
    };
    cache = { key, at: Date.now(), log, status };
    return { log, status };
  } catch (err) {
    const failure = err instanceof LiveLogError ? err : null;
    const status = emptyLogStatus({
      found: true,
      files,
      unavailableReason: failure?.code === 'not_found' ? 'database_missing' : 'unreadable',
      error: { code: failure?.code ?? 'copy_failed', message: (err as Error).message },
    });
    cache = { key, at: Date.now(), log: null, status };
    return { log: null, status };
  }
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
