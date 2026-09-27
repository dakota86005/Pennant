/**
 * The import (N3.5, D-061): all or nothing, off the server's thread.
 *
 * 1. The export must be whole: quiet for `QUIET_MS` (OOTP has finished writing) and every file from one burst. A file
 *    older than the rest was not rewritten this time (a table switched off in OOTP's export settings): it is left out
 *    and named, and its table keeps the previous import's rows, marked stale, when that import was of the same export
 *    folder; otherwise the table is absent. A stale `players`, `teams` or `leagues` refuses the import.
 * 2. There must be room: the new database is built beside the old one (about 4.5 times the export's size).
 * 3. A worker thread builds `league.next.db` (`importBuild.ts`), checking each file again after reading it.
 * 4. One rename swaps it in (`swapInLeagueDatabase`). Until then the app reads the previous import, whole; any failure
 *    before it leaves the previous import in place and removes the unfinished file.
 */
import fs from 'node:fs';
import os from 'node:os';
import { DATA_DIR } from './config.js';
import { LAST_IMPORT_PATH, LEAGUE_DB_PATH, NEXT_DB_PATH, importRecord, swapWhenFree } from './db.js';
import { assessExport, BURST_WINDOW_MS, exportTiming, REQUIRED_TABLES, staleRequired, type ExportAssessment, type ExportFile } from './exportFiles.js';
import { buildLeagueDatabase, BuildError, type BuildResult } from './importBuild.js';
import type { RatingModeRecord } from './ratingMode.js';
import type { Integer } from './contract/primitives.js';

/** What an import did: its tables and rows, when it ran, the export it read, what it left out, and the kind of ratings. */
export interface ImportResult {
  tables: Integer;
  rows: Integer;
  startedAt: string;
  finishedAt: string;
  files: Array<{ table: string; rows: Integer }>;
  /** The export folder this import read (N3.5). */
  csvDir?: string | null;
  /** The export's fingerprint (its files' names, sizes and times), to tell a new export from this one (N3.5). */
  exportFingerprint?: string | null;
  /** When OOTP wrote the newest file of the export this import read (N3.5). */
  exportWrittenAt?: string | null;
  /** Files of the export the import left out, each with why and what the database holds for its table (N3.5). */
  leftOut?: LeftOutFile[];
  /** The files left out, in a sentence for the GM; null when none was (N3.5). */
  leftOutNote?: string | null;
  /** Which kind of ratings the export carries, from OOTP's export settings, read at this import (N3.5, D-061). */
  ratingMode?: RatingModeRecord | null;
  /** How long the import took, in milliseconds, from the build's start to the swap (N3.5). */
  durationMs?: Integer | null;
}

/** A file the import left out (N3.5). */
export interface LeftOutFile {
  table: string;
  file: string;
  /** `stale`: older than the rest of the export (not rewritten); `unreadable`: it could not be parsed. */
  reason: 'stale' | 'unreadable';
  /** When OOTP last wrote it. */
  writtenAt: string | null;
  /** Whether the database keeps the previous import's rows for this table (stale files only, same export folder). */
  kept: boolean;
  /** When the kept rows were imported; null when nothing is kept. */
  keptFrom: string | null;
}

/** Where the import has got to, as the importer reports it. */
export interface ImportStep {
  /** The table being written, as OOTP names the file. */
  table: string;
  /** 1-based, so it reads as "12 of 70" without arithmetic. */
  fileIndex: Integer;
  files: Integer;
  /** Rows written so far, across every table. */
  rows: Integer;
  /** `waiting` (N3.5): OOTP is still writing the export, and the import waits for it to finish. */
  phase: 'reading' | 'writing' | 'indexing' | 'waiting';
}

/** An import step in words (`server/presentation/importWords.ts`), for a window that shows it. */
export interface ImportWords {
  /** What the import is doing ("Reading the export"). */
  phase: string;
  /** The table being written, named for a person ("Standings"); its OOTP file name stays in `table`. */
  table: string;
  /** The line a progress bar shows ("Writing standings · 12 of 70"). */
  display: string;
}

/** Where the import has got to, for a page that would rather not look frozen: the step, and the step in words. */
export interface ImportProgress extends ImportStep {
  words: ImportWords;
}

/** The previous import, as far as the new one needs it (to carry a stale table's rows over). */
export interface PreviousImport {
  /** When it ran. */
  importedAt: string | null;
  /** The export folder it read. */
  csvDir: string | null;
  /** For each table it carried over from an import before it, when those rows were imported. */
  keptFrom: Record<string, string>;
  /** When OOTP wrote the newest file of the export it read (whole milliseconds), or null (N3.5 Stage B2). */
  exportWrittenAtMs?: number | null;
}

export interface ImportOptions {
  onProgress?: (p: ImportStep) => void;
  /** The previous import (the stale-table carry-over reads it); by default what the served database records. */
  previous?: PreviousImport | null;
  /** The export's rating mode, read by the caller from the save's export settings. */
  ratingMode?: RatingModeRecord | null;
  /** Or read once the export has settled, given when its newest file was written (the settings may be newer). */
  ratingModeFor?: (exportWrittenAtMs: number | null) => RatingModeRecord;
  /** Says the files left out in a sentence (`presentation/importWords.ts`). */
  leftOutNote?: (leftOut: LeftOutFile[]) => string | null;
  /** Called between judging the export and reading it, on every attempt (the tests' seam for a file OOTP rewrites then). */
  beforeBuild?: (attempt: number) => void;
  /** Called in the same turn as the swap, before anything else runs (the caller's state and cache clearing). */
  afterSwap?: (result: ImportResult) => void;
}

/** A refusal the GM can act on; its message is the log's, `failedImportText` turns it into words. */
export class ImportRefused extends Error {
  constructor(message: string, readonly code: 'export_changing' | 'stale_required' | 'disk_space' | 'no_files') {
    super(message);
    this.name = 'ImportRefused';
  }
}

/** Settings a test can shorten (the quiet period); the defaults are the measured rule. */
export const importTiming = {
  /**
   * How long an import waits for OOTP to finish writing before it gives up (the watcher starts it again later): longer
   * than the wait for an export in groups (`CLUSTER_SETTLE_MS`), so a paused export is waited out, not refused.
   */
  settleTimeoutMs: 200_000,
  /** Attempts when a file changes while it is read. */
  attempts: 3,
};

/** Free bytes where the data folder lives; a test replaces it. */
export const diskSpace = {
  free(dir: string): number | null {
    try {
      const s = fs.statfsSync(dir);
      return s.bavail * s.bsize;
    } catch {
      return null;
    }
  },
};

/** The new database is about four times the export's size (numbers stored as REAL, plus indexes); with room to spare. */
export const DISK_FACTOR = 4.5;

const gb = (bytes: number): string => `${(bytes / 1024 ** 3).toFixed(1)} GB`;
const iso = (ms: number | null): string | null => (ms === null ? null : new Date(ms).toISOString());
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** The previous import, read from the served database's own record. */
export function previousFromDatabase(): PreviousImport | null {
  const record = importRecord();
  if (!record) return null;
  const carried = new Set(
    (Array.isArray(record.tables) ? (record.tables as Array<{ table?: unknown; source?: unknown }>) : [])
      .filter((t) => t.source === 'carried' && typeof t.table === 'string').map((t) => t.table as string),
  );
  const keptFrom = record.keptFrom && typeof record.keptFrom === 'object' ? (record.keptFrom as Record<string, unknown>) : {};
  return {
    importedAt: typeof record.startedAt === 'string' ? record.startedAt : null,
    csvDir: typeof record.csvDir === 'string' ? record.csvDir : null,
    keptFrom: Object.fromEntries(Object.entries(keptFrom).filter(([t, at]) => carried.has(t) && typeof at === 'string')) as Record<string, string>,
    exportWrittenAtMs: typeof record.exportWrittenAt === 'string' && Number.isFinite(Date.parse(record.exportWrittenAt)) ? Date.parse(record.exportWrittenAt) : null,
  };
}

/** Waits until the export is quiet (OOTP has finished writing), reporting `waiting`; refuses after the timeout. */
async function settledExport(csvDir: string, importedWrittenAtMs: number | null, onProgress?: (p: ImportStep) => void): Promise<ExportAssessment> {
  const started = Date.now();
  for (;;) {
    const now = Date.now();
    const a = assessExport(csvDir, now, importedWrittenAtMs);
    if (a.files.length === 0) throw new ImportRefused(`No .csv files found in ${csvDir}`, 'no_files');
    if (a.settled) return a;
    if (now - started >= importTiming.settleTimeoutMs) {
      throw new ImportRefused('EXPORT_CHANGING: OOTP was still writing the export when the import gave up waiting', 'export_changing');
    }
    onProgress?.({ table: 'export', fileIndex: 1, files: a.files.length, rows: 0, phase: 'waiting' });
    await sleep(Math.min(1000, Math.max(50, a.settlesInMs)));
  }
}

/**
 * Imports the export at `csvDir` into a new database and swaps it in. Resolves with the import's record once the new
 * database is the league; rejects (the previous import untouched) when the export is not whole, there is no room,
 * or a required table cannot be read.
 */
export async function importCsvDir(csvDir: string, onProgressOrOptions?: ((p: ImportStep) => void) | ImportOptions): Promise<ImportResult> {
  const options: ImportOptions = typeof onProgressOrOptions === 'function' ? { onProgress: onProgressOrOptions } : onProgressOrOptions ?? {};
  const startedAt = new Date().toISOString();
  const started = performance.now();
  const previous = options.previous === undefined ? previousFromDatabase() : options.previous;

  // When the newest file of the last import of this same folder was written: a file no newer was not rewritten since
  const importedWrittenAtMs = previous?.csvDir === csvDir ? previous.exportWrittenAtMs ?? null : null;
  for (let attempt = 1; ; attempt++) {
    const assessment = await settledExport(csvDir, importedWrittenAtMs, options.onProgress);
    const ratingMode = options.ratingModeFor ? options.ratingModeFor(assessment.newestMs) : options.ratingMode ?? null;
    const staleRequiredTables = staleRequired(assessment);
    if (staleRequiredTables.length > 0) {
      throw new ImportRefused(`STALE_REQUIRED: ${staleRequiredTables.join(', ')} not rewritten with the rest of the export`, 'stale_required');
    }

    // Room for the new database beside the old one
    const exportBytes = assessment.current.reduce((n, f) => n + f.size, 0);
    const needed = Math.round(exportBytes * DISK_FACTOR);
    const free = diskSpace.free(DATA_DIR);
    if (free !== null && free < needed) {
      throw new ImportRefused(`Not enough free disk space to import: about ${gb(needed)} is needed and ${gb(free)} is free`, 'disk_space');
    }

    // A stale table keeps the previous import's rows only when that import read this same export folder
    const sameFolder = !!previous?.csvDir && previous.csvDir === csvDir;
    const carryOver = sameFolder ? assessment.stale.map((f) => f.table) : [];
    // When the rows a stale table keeps were imported: the import that first read them, however many imports ago
    const keptFrom: Record<string, string> = {};
    for (const table of carryOver) {
      const at = previous?.keptFrom[table] ?? previous?.importedAt ?? null;
      if (at) keptFrom[table] = at;
    }
    const leftOutStale = (kept: Set<string>): LeftOutFile[] =>
      assessment.stale.map((f) => ({
        table: f.table, file: f.file, reason: 'stale', writtenAt: iso(f.mtimeMs),
        kept: kept.has(f.table),
        keptFrom: kept.has(f.table) ? keptFrom[f.table] ?? null : null,
      }));

    let build: BuildResult;
    options.beforeBuild?.(attempt);
    try {
      build = await buildLeagueDatabase({
        csvDir,
        outPath: NEXT_DB_PATH,
        previousPath: fs.existsSync(LEAGUE_DB_PATH) ? LEAGUE_DB_PATH : null,
        files: assessment.current,
        carryOver,
        required: [...REQUIRED_TABLES],
        parseWorkers: parseWorkerCount(),
        meta: {
          startedAt,
          csvDir,
          exportFingerprint: assessment.fingerprint,
          exportWrittenAt: iso(assessment.newestMs),
          ratingMode,
          keptFrom,
          stale: assessment.stale.map((f: ExportFile) => ({ file: f.file, table: f.table, writtenAt: iso(f.mtimeMs) })),
          files: assessment.current.map((f: ExportFile) => ({ file: f.file, table: f.table, size: f.size, writtenAt: iso(f.mtimeMs) })),
        },
      }, options.onProgress);
    } catch (err) {
      fs.rmSync(NEXT_DB_PATH, { force: true });
      if (err instanceof BuildError && err.code === 'export_changed' && attempt < importTiming.attempts) {
        console.warn(`[import] ${err.message}; waiting for OOTP to finish, then reading it again`);
        continue;
      }
      if (err instanceof BuildError && err.code === 'export_changed') throw new ImportRefused(`EXPORT_CHANGING: ${err.message}`, 'export_changing');
      throw err;
    }

    /*
     * The export as a whole, again, before the swap: every file as it was when the build began (none added, removed or
     * rewritten, even one already read) and the folder still settled. OOTP resuming part way through the build, or a
     * file appearing, is caught here and the export is read again; the per-file checks alone could not see a file the
     * build had already finished with. (N3.5 review, finding 2.)
     */
    const now = assessExport(csvDir, Date.now(), importedWrittenAtMs);
    if (now.folderFingerprint !== assessment.folderFingerprint || !now.settled) {
      fs.rmSync(NEXT_DB_PATH, { force: true });
      if (attempt < importTiming.attempts) {
        console.warn('[import] the export changed while it was read; waiting for OOTP to finish, then reading it again');
        continue;
      }
      throw new ImportRefused('EXPORT_CHANGING: the export kept changing while it was read', 'export_changing');
    }

    const carried = new Set(build.tables.filter((t) => t.source === 'carried').map((t) => t.table));
    const leftOut: LeftOutFile[] = [
      ...leftOutStale(carried),
      ...build.unreadable.map((u): LeftOutFile => ({
        table: u.table, file: u.file, reason: 'unreadable',
        writtenAt: iso(assessment.current.find((f) => f.file === u.file)?.mtimeMs ?? null), kept: false, keptFrom: null,
      })),
    ];
    const exported = build.tables.filter((t) => t.source === 'export').sort((a, b) => (a.file < b.file ? -1 : 1));
    const result: ImportResult = {
      tables: exported.length,
      rows: build.rows,
      startedAt,
      finishedAt: new Date().toISOString(),
      files: exported.map((t) => ({ table: t.table, rows: t.rows })),
      csvDir,
      exportFingerprint: assessment.fingerprint,
      exportWrittenAt: iso(assessment.newestMs),
      leftOut,
      leftOutNote: options.leftOutNote?.(leftOut) ?? null,
      ratingMode,
      durationMs: Math.round(performance.now() - started),
    };
    // The swap: from here the app reads the new import (a rename that fails leaves the previous one, and no leftover)
    try {
      await swapWhenFree(NEXT_DB_PATH, () => {
        // The record of the last import, in the same turn as the swap: the database's own record is trusted only beside it
        fs.writeFileSync(LAST_IMPORT_PATH, JSON.stringify(result));
        options.afterSwap?.(result);
      });
    } catch (err) {
      fs.rmSync(NEXT_DB_PATH, { force: true });
      throw err;
    }
    console.log(`[import] ${result.tables} tables, ${result.rows} rows in ${(result.durationMs! / 1000).toFixed(1)}s ` +
      `(parse and write ${build.timings.parseAndWriteMs} ms, indexes ${build.timings.indexMs} ms, ${build.indexes} indexes)` +
      (leftOut.length ? `; left out: ${leftOut.map((l) => `${l.file} (${l.reason})`).join(', ')}` : ''));
    return result;
  }
}

/**
 * The files the served database's import left out, rebuilt from its own record (so it is always the database's truth,
 * whichever process imported it): stale files, with whether their table kept earlier rows and from when; unreadable ones.
 */
export function leftOutOfServedImport(): LeftOutFile[] {
  const record = importRecord();
  if (!record) return [];
  const tables = Array.isArray(record.tables) ? (record.tables as Array<{ table?: unknown; source?: unknown }>) : [];
  const carried = new Set(tables.filter((t) => t.source === 'carried').map((t) => String(t.table)));
  const keptFrom = record.keptFrom && typeof record.keptFrom === 'object' ? (record.keptFrom as Record<string, string>) : {};
  const stale = Array.isArray(record.stale) ? (record.stale as Array<{ file: string; table: string; writtenAt: string | null }>) : [];
  const unreadable = Array.isArray(record.unreadable) ? (record.unreadable as Array<{ file: string; table: string }>) : [];
  const files = Array.isArray(record.files) ? (record.files as Array<{ file: string; writtenAt: string | null }>) : [];
  return [
    ...stale.map((f): LeftOutFile => ({
      table: f.table, file: f.file, reason: 'stale', writtenAt: f.writtenAt ?? null,
      kept: carried.has(f.table), keptFrom: carried.has(f.table) ? keptFrom[f.table] ?? null : null,
    })),
    ...unreadable.map((f): LeftOutFile => ({
      table: f.table, file: f.file, reason: 'unreadable', writtenAt: files.find((x) => x.file === f.file)?.writtenAt ?? null, kept: false, keptFrom: null,
    })),
  ];
}

/** Three parse workers were the measured best on a ten-core M4 (a fourth adds nothing: one writer is the floor). */
function parseWorkerCount(): number {
  const cores = typeof os.availableParallelism === 'function' ? os.availableParallelism() : os.cpus().length;
  return Math.max(1, Math.min(3, cores - 1));
}

/** For the watcher and the status: the stale-file window and quiet period in force. */
export const EXPORT_RULES = { burstWindowMs: BURST_WINDOW_MS, quietMs: () => exportTiming.quietMs };
