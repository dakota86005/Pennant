/**
 * Read-only snapshots of OOTP's live transaction database.
 *
 * OOTP keeps `text_data.sqlite3` (plus `-wal` and `-shm` while the game runs)
 * under `<save>.lg/temp/`. That database is OOTP's, and it may be mid-write, so
 * it is never opened in place. Instead:
 *
 *   1. stat the source files;
 *   2. copy the database and its WAL into a private temp directory;
 *   3. stat the sources again, and reject the copy if anything moved or if a
 *      copy is not the size the source was;
 *   4. open only the copy, read-only, and validate it (`quick_check`, plus the
 *      tables the caller needs);
 *   5. on any of that failing, throw the copy away and retry a few times;
 *   6. remove the temp directory when the snapshot is closed.
 *
 * The `-shm` file is deliberately NOT copied. It is a shared-memory index over
 * the WAL, not data, and SQLite rebuilds it from the copied WAL on open. A
 * copy of it taken at a different instant from the WAL could only mislead.
 *
 * Nothing here opens a source file for writing. The source is touched by
 * `statSync` and by `copyFileSync`, which reads it.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { LIVE_DB_NAME, type LiveDatabaseFiles } from './ootpSave.js';
import type { Integer } from './contract/primitives.js';

export type LiveLogFailure =
  /** The database file is not there. */
  | 'not_found'
  /** The source kept changing while it was copied. */
  | 'torn'
  /** The copy is not a usable database, or lacks the required tables. */
  | 'invalid'
  /** The file could not be read (permissions, I/O). */
  | 'copy_failed';

export class LiveLogError extends Error {
  constructor(
    readonly code: LiveLogFailure,
    message: string,
    readonly attempts = 0
  ) {
    super(message);
    this.name = 'LiveLogError';
  }
}

export interface SnapshotMeta {
  attempts: Integer;
  walCopied: boolean;
  /** Whether the source had a `-shm` file. It is never copied. */
  shmPresent: boolean;
  dbBytes: Integer;
  walBytes: Integer;
  /** Modification times of the source files when copied. */
  sourceModified: { db: string | null; wal: string | null };
  copiedAt: string;
}

export interface LiveSnapshot {
  db: InstanceType<typeof Database>;
  meta: SnapshotMeta;
  /** Closes the copy and deletes its temp directory. Safe to call twice. */
  close(): void;
}

export interface SnapshotOptions {
  /** Tables the copy must contain to count as valid. */
  requiredTables?: string[];
  attempts?: number;
  /** Pause between attempts, in ms. */
  retryDelayMs?: number;
  /** Where private copies are made. Defaults to the OS temp directory. */
  tempRoot?: string;
  /** Test seam: runs after the copy and before it is verified. */
  afterCopy?: (attempt: number) => void;
}

const PREFIX = 'pennant-ootp-log-';

interface Sig {
  size: number;
  mtimeMs: number;
}

const sigOf = (file: string): Sig | null => {
  try {
    const st = fs.statSync(file);
    return st.isFile() ? { size: st.size, mtimeMs: st.mtimeMs } : null;
  } catch {
    return null;
  }
};

const same = (a: Sig | null, b: Sig | null): boolean =>
  a === b || (!!a && !!b && a.size === b.size && a.mtimeMs === b.mtimeMs);

/** A short blocking pause; the reader is synchronous like the rest of the server. */
function pause(ms: number): void {
  if (ms > 0) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** Only ever removes a directory this module created. */
function removeOwnTempDir(dir: string, root: string): void {
  if (path.dirname(dir) !== root || !path.basename(dir).startsWith(PREFIX)) return;
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // Best effort: the sweep on a later run picks up what this misses
  }
}

let swept = false;

/** Removes copies a crashed process left behind. Runs at most once per process. */
export function sweepStaleSnapshots(root = os.tmpdir(), maxAgeMs = 60 * 60 * 1000): void {
  if (swept && root === os.tmpdir()) return;
  if (root === os.tmpdir()) swept = true;
  try {
    for (const name of fs.readdirSync(root)) {
      if (!name.startsWith(PREFIX)) continue;
      const dir = path.join(root, name);
      try {
        if (Date.now() - fs.statSync(dir).mtimeMs > maxAgeMs) removeOwnTempDir(dir, root);
      } catch {
        // Gone already, or not ours to read
      }
    }
  } catch {
    // The temp root is unreadable; there is nothing to sweep
  }
}

function validate(db: InstanceType<typeof Database>, required: string[]): string | null {
  const check = db.pragma('quick_check', { simple: true });
  if (check !== 'ok') return `integrity check failed: ${String(check)}`;
  for (const table of required) {
    const found = db.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`).get(table);
    if (!found) return `missing table ${table}`;
  }
  return null;
}

/**
 * Takes a validated, private, read-only copy of the live database.
 * Throws {@link LiveLogError} when no consistent copy can be had.
 */
export function openLiveSnapshot(files: LiveDatabaseFiles, opts: SnapshotOptions = {}): LiveSnapshot {
  const attempts = Math.max(1, opts.attempts ?? 3);
  const required = opts.requiredTables ?? [];
  const root = fs.realpathSync(opts.tempRoot ?? os.tmpdir());
  sweepStaleSnapshots();

  let lastFailure = new LiveLogError('torn', 'The live database changed while it was being copied.');

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const dbBefore = sigOf(files.db);
    if (!dbBefore) throw new LiveLogError('not_found', `No live database at ${files.db}.`, attempt);
    const walBefore = sigOf(files.wal);

    let dir: string | null = null;
    let handle: InstanceType<typeof Database> | null = null;
    try {
      dir = fs.mkdtempSync(path.join(root, PREFIX));
      const dbCopy = path.join(dir, LIVE_DB_NAME);
      const walCopy = `${dbCopy}-wal`;

      try {
        fs.copyFileSync(files.db, dbCopy);
        if (walBefore) fs.copyFileSync(files.wal, walCopy);
      } catch (err) {
        throw new LiveLogError('copy_failed', `Could not read the live database: ${(err as Error).message}`, attempt);
      }

      opts.afterCopy?.(attempt);

      const dbAfter = sigOf(files.db);
      const walAfter = sigOf(files.wal);
      const copied = { db: fs.statSync(dbCopy).size, wal: walBefore ? fs.statSync(walCopy).size : 0 };
      if (
        !same(dbBefore, dbAfter) ||
        !same(walBefore, walAfter) ||
        copied.db !== dbBefore.size ||
        copied.wal !== (walBefore?.size ?? 0)
      ) {
        throw new LiveLogError('torn', 'The live database changed while it was being copied.', attempt);
      }

      try {
        handle = new Database(dbCopy, { readonly: true, fileMustExist: true });
      } catch (err) {
        throw new LiveLogError('invalid', `The copied database would not open: ${(err as Error).message}`, attempt);
      }
      let problem: string | null;
      try {
        problem = validate(handle, required);
      } catch (err) {
        problem = (err as Error).message;
      }
      if (problem) throw new LiveLogError('invalid', `The copied database is not usable: ${problem}.`, attempt);

      const opened = handle;
      const ownDir = dir;
      let closed = false;
      return {
        db: opened,
        meta: {
          attempts: attempt,
          walCopied: !!walBefore,
          shmPresent: !!sigOf(files.shm),
          dbBytes: dbBefore.size,
          walBytes: walBefore?.size ?? 0,
          sourceModified: {
            db: new Date(dbBefore.mtimeMs).toISOString(),
            wal: walBefore ? new Date(walBefore.mtimeMs).toISOString() : null,
          },
          copiedAt: new Date().toISOString(),
        },
        close() {
          if (closed) return;
          closed = true;
          try {
            opened.close();
          } catch {
            // Already closed
          }
          removeOwnTempDir(ownDir, root);
        },
      };
    } catch (err) {
      try {
        handle?.close();
      } catch {
        // Nothing to release
      }
      if (dir) removeOwnTempDir(dir, root);
      if (!(err instanceof LiveLogError)) throw err;
      // A missing file or a permissions problem will not improve on a retry
      if (err.code === 'not_found' || err.code === 'copy_failed') throw err;
      lastFailure = err;
      if (attempt < attempts) pause(opts.retryDelayMs ?? 60 * attempt);
    }
  }
  throw new LiveLogError(lastFailure.code, lastFailure.message, attempts);
}

/** Runs `fn` against a snapshot and always cleans the copy up. */
export function withLiveSnapshot<T>(
  files: LiveDatabaseFiles,
  fn: (snapshot: LiveSnapshot) => T,
  opts?: SnapshotOptions
): T {
  const snapshot = openLiveSnapshot(files, opts);
  try {
    return fn(snapshot);
  } finally {
    snapshot.close();
  }
}
