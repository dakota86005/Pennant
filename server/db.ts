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
 * Opens a league database for serving. Read-only where it can be: a folder with no import yet gets an empty file
 * first, and a file the earlier (Electron) build left in write-ahead-log mode is opened as it is until the start-up
 * tidy (`prepareLeagueDatabase`) converts it under the data-folder lock.
 */
function openServing(file: string): Database.Database {
  if (READ_ONLY_REPORT) return new Database(file, { readonly: true, fileMustExist: true });
  if (WRITABLE) {
    const conn = new Database(file);
    for (const p of SERVING_PRAGMAS) conn.pragma(p);
    return conn;
  }
  if (!fs.existsSync(file)) new Database(file).close();
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

function renameWithRetry(from: string, to: string): void {
  // Windows refuses to rename over a file another handle holds open (a refit still reading the old import): wait a little
  const deadline = Date.now() + (process.platform === 'win32' ? 30_000 : 0);
  for (;;) {
    try {
      fs.renameSync(from, to);
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (Date.now() >= deadline || (code !== 'EPERM' && code !== 'EBUSY' && code !== 'EACCES')) throw err;
      const until = Date.now() + 200;
      while (Date.now() < until) { /* a short synchronous wait: the swap is one step */ }
    }
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
  for (const suffix of ['-wal', '-shm']) fs.rmSync(LEAGUE_DB_PATH + suffix, { force: true });
  renameWithRetry(nextPath, LEAGUE_DB_PATH);
  fsyncDirectory(DATA_DIR);
  db = openServing(LEAGUE_DB_PATH);
  generation += 1;
  if (process.platform !== 'win32') retire(old);
}

/**
 * The start-up tidy, under the data-folder lock (`startServer`): removes a crashed import's leftover build, and brings
 * a database from an earlier build to the served shape once: out of write-ahead-log mode (the old Electron build sets
 * it on every open) and with every index an import now builds. Costs nothing on a database already in shape.
 */
export function prepareLeagueDatabase(): { removedLeftover: boolean; converted: boolean; indexesAdded: number } {
  const outcome = { removedLeftover: false, converted: false, indexesAdded: 0 };
  if (READ_ONLY_REPORT) return outcome;
  for (const suffix of ['', '-journal', '-wal', '-shm']) {
    if (fs.existsSync(NEXT_DB_PATH + suffix)) {
      fs.rmSync(NEXT_DB_PATH + suffix, { force: true });
      outcome.removedLeftover = true;
    }
  }
  if (outcome.removedLeftover) console.warn('[import] removed an unfinished import\'s file; the league is the last complete import');
  const wal = isWalFile(LEAGUE_DB_PATH);
  const missing = missingIndexes(db);
  if (!wal && missing.length === 0) return outcome;
  // One read-write connection for the tidy; the served one is reopened read-only after it
  const conn = db.readonly ? new Database(LEAGUE_DB_PATH) : db;
  try {
    if (wal) {
      conn.pragma('wal_checkpoint(TRUNCATE)');
      conn.pragma('journal_mode = DELETE');
      outcome.converted = true;
    }
    for (const { table, name, columns } of missing) {
      try {
        conn.exec(`CREATE INDEX IF NOT EXISTS "${name}" ON "${table}" (${columns.map((c) => `"${c}"`).join(', ')})`);
        outcome.indexesAdded += 1;
      } catch (err) {
        console.warn(`[import] index ${name} failed:`, (err as Error).message);
      }
    }
    if (outcome.indexesAdded > 0) conn.exec('ANALYZE');
  } finally {
    if (conn !== db) conn.close();
  }
  if (conn !== db || wal) {
    const old = db;
    db = openServing(LEAGUE_DB_PATH);
    generation += 1;
    try { old.close(); } catch { /* already closed */ }
  }
  if (outcome.converted || outcome.indexesAdded > 0) {
    console.log(`[import] brought the league database up to date (${outcome.converted ? 'journal mode, ' : ''}${outcome.indexesAdded} indexes)`);
  }
  return outcome;
}

/** The indexes an import builds that this database lacks (an import from an earlier build). */
function missingIndexes(conn: Database.Database): Array<{ table: string; name: string; columns: string[] }> {
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

/** What the served database records about its own import (`pennant_import`), or null for one built before N3.5. */
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
  cachedRecord = { generation, conn: db, value };
  return value;
}
let cachedRecord: { generation: number; conn: Database.Database; value: Record<string, unknown> | null } | null = null;

/** Forgets the cached record, for a test that writes one into its league by hand. */
export function forgetImportRecord(): void {
  cachedRecord = null;
}
