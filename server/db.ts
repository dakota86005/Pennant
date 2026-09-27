import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './config.js';
import { indexesFor } from './importWorker.js';

fs.mkdirSync(DATA_DIR, { recursive: true });

/**
 * The league database, `league.db`: the last import, served read-only (N3.5, D-061).
 *
 * `league.db` is written only by an import, and an import no longer writes the file the app reads: it builds
 * `league.next.db` in a worker (`importBuild.ts`) and swaps it in with one rename (`swapInLeagueDatabase`). So the
 * served connection is read-only, in rollback-journal mode (no write-ahead log to go stale across a rename), with
 * memory-mapped reads and a large page cache.
 *
 * `db` is a live binding: every module imports it and reads `db` at call time, so after a swap they all read the new
 * database. A module must never keep `db` (or a statement prepared on it) in a variable of its own across requests.
 *
 * `OOTP_FO_DB_READONLY=1` opens an existing import read-only for a report against a real league
 * (`npm run value:report`); nothing at all is changed then, not even the start-up tidy. `OOTP_FO_DB_WRITABLE=1`
 * opens it read-write, for the tests and the synthetic-league script, which build their leagues through `db`.
 */
const READ_ONLY_REPORT = process.env.OOTP_FO_DB_READONLY === '1';
const WRITABLE = process.env.OOTP_FO_DB_WRITABLE === '1' && !READ_ONLY_REPORT;

export const LEAGUE_DB_PATH = path.join(DATA_DIR, 'league.db');
/** Where an import builds the next database; a leftover is a crashed import's, removed at start. */
export const NEXT_DB_PATH = path.join(DATA_DIR, 'league.next.db');

/** Memory-mapped reads (2 GB) and a 128 MB page cache: measured 10 to 25% faster on the slow pages (N3.5 Stage A). */
const SERVING_PRAGMAS = ['mmap_size = 2147483648', 'cache_size = -131072'];

/** Whether a database file's header says write-ahead-log mode (bytes 18 and 19 are 2). */
export function isWalFile(file: string): boolean {
  try {
    const fd = fs.openSync(file, 'r');
    try {
      const header = Buffer.alloc(20);
      return fs.readSync(fd, header, 0, 20, 0) === 20 && header[18] === 2 && header[19] === 2;
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return false;
  }
}

/**
 * Rolls back a hot rollback journal (`league.db-journal`), left when a process writing the database in place was
 * killed: the earlier (Electron) build's import, or this build's start-up tidy before N3.5's review. A read-only
 * connection cannot roll one back, so every read would fail (SQLITE_READONLY_ROLLBACK) and the server could never start.
 * One read through a read-write connection makes SQLite roll it back; a journal that is not hot (another live process
 * holds its lock) is left alone by SQLite itself. Returns whether there was a journal.
 */
export function rollBackHotJournal(file: string = LEAGUE_DB_PATH): boolean {
  let size = 0;
  try {
    size = fs.statSync(`${file}-journal`).size;
  } catch {
    return false;
  }
  if (size === 0 || !fs.existsSync(file)) return false;
  const conn = new Database(file);
  try {
    conn.prepare(`SELECT COUNT(*) FROM sqlite_master`).get();
  } finally {
    conn.close();
  }
  console.warn('[import] rolled back an unfinished write to the league database (a process was stopped partway)');
  return true;
}

/**
 * Opens a league database for serving. Read-only where it can be: a folder with no import yet gets an empty file
 * first, a hot journal is rolled back first, and a file the earlier (Electron) build left in write-ahead-log mode is
 * opened as it is until the start-up upgrade (`upgradeLeagueInBackground`, api.ts) swaps in a converted copy.
 */
function openServing(file: string): Database.Database {
  if (READ_ONLY_REPORT) return new Database(file, { readonly: true, fileMustExist: true });
  if (WRITABLE) {
    const conn = new Database(file);
    for (const p of SERVING_PRAGMAS) conn.pragma(p);
    return conn;
  }
  if (!fs.existsSync(file)) new Database(file).close();
  rollBackHotJournal(file);
  const conn = isWalFile(file) ? new Database(file) : new Database(file, { readonly: true, fileMustExist: true });
  for (const p of SERVING_PRAGMAS) conn.pragma(p);
  return conn;
}

export let db: Database.Database = openServing(LEAGUE_DB_PATH);

/** Counts swaps, so a cache keyed on the database can tell a new import from the one it read. */
let generation = 0;
export const databaseGeneration = (): number => generation;

/**
 * How long a replaced connection stays open after a swap. Every read is synchronous and no statement or iterator is
 * kept across an `await`, so nothing can still be reading it after the swap's turn; the grace only covers a handler
 * that holds `db` in a local across one. Short, because until it closes the replaced file's space is not given back.
 */
export const leagueDbTiming = { retireMs: 5_000 };
const retired = new Set<Database.Database>();

function retire(old: Database.Database): void {
  retired.add(old);
  const timer = setTimeout(() => {
    retired.delete(old);
    try { if (old.open) old.close(); } catch (err) { console.error('[db] closing the previous database failed:', err); }
  }, leagueDbTiming.retireMs);
  timer.unref();
}

/** Replaced connections not yet closed (each holds its file's space until it closes). */
export const retiredConnections = (): number => retired.size;

/** Closes the served database and any replaced one still open (the server's shutdown). */
export function closeLeagueDatabase(): void {
  for (const conn of [db, ...retired]) {
    try { if (conn.open) conn.close(); } catch (err) { console.error('[db] closing the league database failed:', err); }
  }
  retired.clear();
}

function fsyncDirectory(dir: string): void {
  try {
    const fd = fs.openSync(dir, 'r');
    try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  } catch {
    // Not every platform lets a directory be opened for sync (Windows); the rename itself is still atomic there
  }
}

/**
 * Makes a finished build the league: one rename over `league.db`, the directory flushed, the served connection
 * reopened on the new file and the old one retired. Synchronous, so no request runs between the old database and
 * the new. On macOS and Linux the old file stays readable to the connections that still hold it until they close.
 */
export function swapInLeagueDatabase(nextPath: string = NEXT_DB_PATH): void {
  const old = db;
  // Windows cannot rename over an open file: the old connection closes first (nothing runs between these lines)
  if (process.platform === 'win32') {
    try { old.close(); } catch { /* already closed */ }
  }
  // No journal of the replaced file may ever meet the new one (a hot one would be rolled back into it)
  for (const suffix of ['-journal', '-wal', '-shm']) fs.rmSync(LEAGUE_DB_PATH + suffix, { force: true });
  try {
    fs.renameSync(nextPath, LEAGUE_DB_PATH);
  } catch (err) {
    // The previous import stays the league: on Windows its connection was closed for the rename, so it is reopened
    if (!old.open) db = openServing(LEAGUE_DB_PATH);
    throw err;
  }
  fsyncDirectory(DATA_DIR);
  db = openServing(LEAGUE_DB_PATH);
  generation += 1;
  if (process.platform !== 'win32') retire(old);
}

/** Rename failures Windows gives while another handle (a refit worker still reading the old import) holds the file. */
const HELD = new Set(['EPERM', 'EBUSY', 'EACCES']);

/**
 * The swap, waiting without blocking when the old file is held open. Only Windows refuses to rename over an open file
 * (the Electron build there; Pennant for Mac is macOS only, where the first try succeeds): each refused try reopens the
 * previous import, which is served meanwhile, and the next try comes half a second later, for up to a minute (a refit
 * reading the old file finishes within that). `then` runs in the same turn as the successful swap, before any request.
 */
export async function swapWhenFree(nextPath: string, then: () => void, tries = 120): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      swapInLeagueDatabase(nextPath);
      then();
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code ?? '';
      if (process.platform !== 'win32' || !HELD.has(code) || attempt >= tries) throw err;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

/**
 * The start-up tidy, under the data-folder lock (`startServer`): removes a crashed import's or upgrade's leftover
 * `league.next.db`, rolls back a hot journal, and says whether the served database needs the one-time upgrade to the
 * served shape (out of write-ahead-log mode, the old Electron build's; every index an import now builds). It never
 * writes the served file in place: the upgrade builds a converted copy and swaps it in, the way an import does
 * (`upgradeLeagueInBackground`), so a process stopped at any point leaves the previous file as it was.
 */
export function prepareLeagueDatabase(): { removedLeftover: boolean; rolledBack: boolean; needsUpgrade: boolean } {
  const outcome = { removedLeftover: false, rolledBack: false, needsUpgrade: false };
  if (READ_ONLY_REPORT) return outcome;
  for (const suffix of ['', '-journal', '-wal', '-shm']) {
    if (fs.existsSync(NEXT_DB_PATH + suffix)) {
      fs.rmSync(NEXT_DB_PATH + suffix, { force: true });
      outcome.removedLeftover = true;
    }
  }
  if (outcome.removedLeftover) console.warn('[import] removed an unfinished import\'s file; the league is the last complete import');
  if (!WRITABLE && rollBackHotJournal(LEAGUE_DB_PATH)) {
    outcome.rolledBack = true;
    const old = db;
    db = openServing(LEAGUE_DB_PATH);
    generation += 1;
    try { old.close(); } catch { /* already closed */ }
  }
  outcome.needsUpgrade = !WRITABLE && tableCount(db) > 0 && (isWalFile(LEAGUE_DB_PATH) || missingIndexes(db).length > 0);
  return outcome;
}

function tableCount(conn: Database.Database): number {
  return (conn.prepare(`SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table'`).get() as { n: number }).n;
}

/** The indexes an import builds that this database lacks (an import from an earlier build). */
export function missingIndexes(conn: Database.Database): Array<{ table: string; name: string; columns: string[] }> {
  const have = new Set((conn.prepare(`SELECT name FROM sqlite_master WHERE type = 'index'`).all() as Array<{ name: string }>).map((r) => r.name));
  const tables = (conn.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name <> 'pennant_import'`).all() as Array<{ name: string }>).map((r) => r.name);
  const out: Array<{ table: string; name: string; columns: string[] }> = [];
  for (const table of tables) {
    const columns = new Set((conn.prepare(`PRAGMA table_info("${table.replace(/"/g, '')}")`).all() as Array<{ name: string }>).map((c) => c.name));
    for (const index of indexesFor(table, columns)) if (!have.has(index.name)) out.push({ table, ...index });
  }
  return out;
}

/*
 * The served database's schema, remembered per connection: it changes only when an import swaps a new file in (a new
 * connection). Asked thousands of times a page (every schema-tolerant read checks its columns), it cost about a
 * sixth of a slow page's time (N3.5). Not kept on a writable connection (the tests and the synthetic-league script
 * change their league's tables through it).
 */
let schemaOf: { conn: Database.Database; tables: Map<string, string[] | null> } | null = null;

function schema(): Map<string, string[] | null> | null {
  if (!db.readonly) return null;
  if (schemaOf?.conn !== db) schemaOf = { conn: db, tables: new Map() };
  return schemaOf.tables;
}

function readColumns(name: string): string[] | null {
  if (!db.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`).get(name)) return null;
  return (db.prepare(`PRAGMA table_info("${name.replace(/"/g, '')}")`).all() as { name: string }[]).map((r) => r.name);
}

function columnsOf(name: string): string[] | null {
  const known = schema();
  if (!known) return readColumns(name);
  if (!known.has(name)) known.set(name, readColumns(name));
  return known.get(name)!;
}

export function tableExists(name: string): boolean {
  return columnsOf(name) !== null;
}

export function tableColumns(name: string): string[] {
  return [...(columnsOf(name) ?? [])];
}

/**
 * Whether a table has every column named.
 *
 * `tableExists` is not enough on its own. OOTP's CSV export changes shape
 * between versions, and a table that is present with an older set of columns
 * passes the existence check and then throws "no such column" the moment it is
 * queried — which reaches the reader as a bare 500 with nothing to act on.
 * Ask for the columns a query actually needs.
 */
export function hasColumns(table: string, ...columns: string[]): boolean {
  const present = new Set(tableColumns(table));
  return columns.every((c) => present.has(c));
}

/**
 * Find where a column lives. OOTP's CSV schema shifts slightly between
 * versions, so callers pass candidate (table, column) pairs and get back the
 * first one that exists in the imported data.
 */
export function locateColumn(candidates: Array<[table: string, column: string]>): [string, string] | null {
  for (const [table, column] of candidates) {
    if (tableColumns(table).includes(column)) return [table, column];
  }
  return null;
}

/** `last-import.json`: the record of the last import, which every build (the earlier Electron one too) writes. */
export const LAST_IMPORT_PATH = path.join(DATA_DIR, 'last-import.json');

function lastImportStartedAt(): string | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(LAST_IMPORT_PATH, 'utf8')) as { startedAt?: unknown };
    return typeof parsed.startedAt === 'string' ? parsed.startedAt : null;
  } catch {
    return null;
  }
}

/**
 * What the served database records about its own import (`pennant_import`), or null for one built before N3.5. Trusted
 * only when it is the last import's: the earlier (Electron) build imports into the same file in place and leaves this
 * table behind, so a record whose start differs from `last-import.json`'s describes an older import (N3.5 review,
 * finding 3), and is treated as absent: the kind of ratings unknown, nothing left out, nothing carried.
 */
export function importRecord(): Record<string, unknown> | null {
  if (cachedRecord && cachedRecord.generation === generation && cachedRecord.conn === db) return cachedRecord.value;
  let value: Record<string, unknown> | null = null;
  try {
    const row = tableExists('pennant_import')
      ? (db.prepare(`SELECT value FROM pennant_import WHERE key = 'import'`).get() as { value: string } | undefined)
      : undefined;
    value = row ? (JSON.parse(row.value) as Record<string, unknown>) : null;
  } catch {
    value = null;
  }
  if (value && value.startedAt !== lastImportStartedAt()) value = null;
  cachedRecord = { generation, conn: db, value };
  return value;
}
let cachedRecord: { generation: number; conn: Database.Database; value: Record<string, unknown> | null } | null = null;

/** Forgets the cached record, for a test that writes one into its league by hand. */
export function forgetImportRecord(): void {
  cachedRecord = null;
}
