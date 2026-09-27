/**
 * Builds a new league database from an export, off the server's thread (N3.5, D-061).
 *
 * The import no longer writes the database the app is reading. A worker thread (`importWorker.ts`) builds a new file,
 * `league.next.db`, beside `league.db`: three parse workers stream the CSVs and one writer inserts them, with build
 * settings that are safe only because the file is thrown away on any failure (no journal, no sync, one big
 * transaction). The indexes are built in the new file too, then ANALYZE, then an `pennant_import` table describing the
 * import is written inside it, so the database describes itself. The file is closed in rollback-journal mode and
 * flushed to disk. Only then does the main thread swap it in (`swapInLeagueDatabase`, `db.ts`) with one rename.
 *
 * Nothing on the server's thread parses or writes: `/api/status` and every page keep answering from the previous
 * database until the swap, and a crash at any point before it leaves the previous database whole (the leftover
 * `league.next.db` is removed at the next start).
 */
import { Worker } from 'node:worker_threads';
import type { Integer } from './contract/primitives.js';
import type { ExportFile } from './exportFiles.js';
import type { ImportStep } from './importer.js';

/** What the build worker is asked to do. */
export interface BuildSpec {
  csvDir: string;
  /** The new file to build (`league.next.db`). */
  outPath: string;
  /** The database in use now, read only to carry a stale table's previous rows over. */
  previousPath: string | null;
  /** The export's files to read, as `stat` saw them before the build; each is checked again after reading. */
  files: ExportFile[];
  /** Tables to copy from the previous database, marked stale (the export's file for them was not rewritten). */
  carryOver: string[];
  /** Tables whose unreadable file fails the import (the previous database stays). */
  required: string[];
  /** Parse workers; the writer is one more. */
  parseWorkers: number;
  /** What the new database records about its import (`pennant_import`), as JSON. */
  meta: Record<string, unknown>;
}

/** A table the build wrote. */
export interface BuiltTable {
  table: string;
  file: string;
  rows: Integer;
  /** `export`: read from this export; `carried`: the previous import's rows, kept because this export's file is stale. */
  source: 'export' | 'carried';
}

/** A file the build could not read (a parse failure). Its table is absent from the new database: unknown, never old. */
export interface UnreadableFile {
  table: string;
  file: string;
  error: string;
}

export interface BuildResult {
  tables: BuiltTable[];
  unreadable: UnreadableFile[];
  /** Carry-over tables the previous database did not have: they are absent. */
  notCarried: string[];
  rows: Integer;
  indexes: Integer;
  timings: { parseAndWriteMs: number; carryMs: number; indexMs: number; totalMs: number };
}

/** Why a build failed, so the caller can tell a changing export (try again later) from a real failure. */
export class BuildError extends Error {
  constructor(message: string, readonly code: 'export_changed' | 'required_unreadable' | 'row_count' | 'failed') {
    super(message);
    this.name = 'BuildError';
  }
}

/** Messages from the build worker. */
export type BuildMessage =
  | { type: 'progress'; step: ImportStep }
  | { type: 'done'; result: BuildResult }
  | { type: 'error'; message: string; code: BuildError['code'] };

/** The build worker's entry: the bundled builds ship it beside the bundle; the source runs it as TypeScript. */
export function importWorkerUrl(): URL {
  const here = new URL(import.meta.url);
  return here.pathname.endsWith('.cjs') ? new URL('./import-worker.cjs', here) : new URL('./importWorker.ts', here);
}

/** Builds the database in a worker thread; resolves when the file is complete, closed and flushed. */
export function buildLeagueDatabase(spec: BuildSpec, onProgress?: (step: ImportStep) => void): Promise<BuildResult> {
  return new Promise((resolve, reject) => {
    let worker: Worker;
    try {
      worker = new Worker(importWorkerUrl(), { workerData: { role: 'build', spec } });
    } catch (err) {
      reject(err);
      return;
    }
    let settled = false;
    const finish = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      fn();
      void worker.terminate();
    };
    worker.on('message', (m: BuildMessage) => {
      if (m.type === 'progress') onProgress?.(m.step);
      else if (m.type === 'done') finish(() => resolve(m.result));
      else finish(() => reject(new BuildError(m.message, m.code)));
    });
    worker.once('error', (err) => finish(() => reject(err)));
    worker.once('exit', (code) => finish(() => reject(new Error(`the import worker stopped (exit ${code}) before it finished`))));
  });
}
