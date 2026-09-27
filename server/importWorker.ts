/**
 * The import's worker thread (N3.5, D-061): builds `league.next.db` from the export, and parses CSVs for it.
 *
 * One file, two roles, chosen by `workerData.role`:
 *   build   the writer. Starts the parse workers (this same file), creates each table from its file's header row,
 *           inserts the rows they send, copies stale tables from the previous database, builds the indexes, runs
 *           ANALYZE, records the import inside the file, and closes it in rollback-journal mode, flushed to disk.
 *   parse   reads one file at a time, checks it did not change while it was read, parses it as a stream and sends
 *           converted rows in batches.
 *
 * Self-contained on purpose: it imports only Node, better-sqlite3 and csv-parse (and types), so it runs as TypeScript
 * under Node's type stripping (tests), under tsx (development) and bundled beside the server (`import-worker.cjs`).
 * The rules it applies are the importer's since the first version: one table per file, columns from the header row,
 * a value that looks numeric stored as a number, UTF-8 with a Latin-1 fallback, the delimiter read off the header.
 */
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { isUtf8 } from 'node:buffer';
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { parse } from 'csv-parse';
import type { BuildMessage, BuildResult, BuildSpec, BuiltTable, UnreadableFile } from './importBuild.js';
import type { ExportFile } from './exportFiles.js';
import type { ImportStep } from './importer.js';

const NUMERIC = /^-?\d+(\.\d+)?$/;
/** Rows per message from a parser to the writer. */
const BATCH = 5000;
/** Batches a parser may have in flight before it waits for the writer. */
const CREDITS = 6;
/** Bytes fed to the parser at a time. */
const SLICE = 1 << 20;

const sanitizeIdent = (name: string): string => name.replace(/[^a-zA-Z0-9_]/g, '_');

/** The columns every page filters on, plus the season index the investigation found missing (`MAX(year)`, `year = ? AND split_id = ?`). */
export const INDEXED_COLUMNS = ['player_id', 'team_id', 'game_id', 'league_id'] as const;

/** The indexes for one table's columns: name and column list. */
export function indexesFor(table: string, columns: Set<string>): Array<{ name: string; columns: string[] }> {
  const out: Array<{ name: string; columns: string[] }> = [];
  for (const c of INDEXED_COLUMNS) if (columns.has(c)) out.push({ name: `idx_${table}_${c}`, columns: [c] });
  if (columns.has('year') && columns.has('split_id')) out.push({ name: `idx_${table}_year_split`, columns: ['year', 'split_id'] });
  else if (columns.has('year')) out.push({ name: `idx_${table}_year`, columns: ['year'] });
  return out;
}

/** Which character separates the fields: whichever candidate appears most often outside quotes in the header row. */
function detectDelimiter(header: string): string {
  let best = ',';
  let bestCount = 0;
  for (const candidate of [',', ';', '\t', '|']) {
    let count = 0;
    let inQuotes = false;
    for (const ch of header) {
      if (ch === '"') inQuotes = !inQuotes;
      else if (ch === candidate && !inQuotes) count += 1;
    }
    if (count > bestCount) {
      best = candidate;
      bestCount = count;
    }
  }
  return best;
}

// ── Parse role ───────────────────────────────────────────────────────────

type ParseRequest = { file: string; filePath: string; size: number; mtimeMs: number };
type ParseOut =
  | { kind: 'header'; file: string; header: string[] }
  | { kind: 'rows'; file: string; rows: unknown[][] }
  | { kind: 'end'; file: string; rows: number }
  | { kind: 'changed'; file: string }
  | { kind: 'failed'; file: string; error: string };

const sameFile = (a: fs.Stats, b: fs.Stats): boolean => a.size === b.size && a.mtimeMs === b.mtimeMs && a.ino === b.ino;

function runParser(): void {
  const port = parentPort!;
  let credits = CREDITS;
  let wake: (() => void) | null = null;
  port.on('message', (m: { ack?: true } & Partial<ParseRequest>) => {
    if (m.ack) {
      credits += 1;
      wake?.();
      wake = null;
      return;
    }
    void parseOne(m as ParseRequest);
  });
  const post = (msg: ParseOut): void => port.postMessage(msg);
  const waitForCredit = async (): Promise<void> => {
    while (credits <= 0) await new Promise<void>((resolve) => { wake = resolve; });
    credits -= 1;
  };

  async function parseOne(req: ParseRequest): Promise<void> {
    let buf: Buffer;
    try {
      const fd = fs.openSync(req.filePath, 'r');
      try {
        const before = fs.fstatSync(fd);
        // Not the file the listing saw: OOTP wrote it since
        if (before.size !== req.size || before.mtimeMs !== req.mtimeMs) return post({ kind: 'changed', file: req.file });
        buf = fs.readFileSync(fd);
        const after = fs.fstatSync(fd);
        // Written while it was read, or replaced under its name
        if (!sameFile(before, after) || !sameFile(before, fs.statSync(req.filePath))) return post({ kind: 'changed', file: req.file });
      } finally {
        fs.closeSync(fd);
      }
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      // Gone between the listing and the read: OOTP is writing the export
      if (code === 'ENOENT') return post({ kind: 'changed', file: req.file });
      return post({ kind: 'failed', file: req.file, error: (err as Error).message });
    }
    // OOTP exports can be Latin-1 (accented names); a file that is not valid UTF-8 is read as Latin-1
    const encoding: BufferEncoding = isUtf8(buf) ? 'utf8' : 'latin1';
    const newline = buf.indexOf(0x0a);
    const delimiter = detectDelimiter(buf.subarray(0, newline === -1 ? buf.length : newline).toString(encoding));
    let header: string[] | null = null;
    let batch: unknown[][] = [];
    let rows = 0;
    try {
      const parser = parse({ delimiter, encoding, relax_column_count: true, relax_quotes: true, skip_empty_lines: true });
      const feed = (async () => {
        for (let at = 0; at < buf.length; at += SLICE) {
          if (!parser.write(buf.subarray(at, Math.min(at + SLICE, buf.length)))) await new Promise<void>((r) => parser.once('drain', r));
        }
        parser.end();
      })();
      for await (const record of parser as AsyncIterable<string[]>) {
        if (!header) {
          header = record.map((h, i) => sanitizeIdent(h.trim() || `col_${i}`));
          post({ kind: 'header', file: req.file, header });
          continue;
        }
        const cols = header.length;
        const values = new Array<unknown>(cols);
        for (let i = 0; i < cols; i++) {
          const v = record[i];
          values[i] = v === undefined || v === '' ? null : NUMERIC.test(v) ? Number(v) : v;
        }
        batch.push(values);
        rows += 1;
        if (batch.length === BATCH) {
          await waitForCredit();
          post({ kind: 'rows', file: req.file, rows: batch });
          batch = [];
        }
      }
      await feed;
    } catch (err) {
      return post({ kind: 'failed', file: req.file, error: (err as Error).message });
    }
    if (batch.length > 0) {
      await waitForCredit();
      post({ kind: 'rows', file: req.file, rows: batch });
    }
    post({ kind: 'end', file: req.file, rows });
  }
}

// ── Build role ───────────────────────────────────────────────────────────

function removeDatabaseFiles(file: string): void {
  for (const suffix of ['', '-journal', '-wal', '-shm']) fs.rmSync(file + suffix, { force: true });
}

async function runBuild(spec: BuildSpec): Promise<void> {
  const port = parentPort!;
  const send = (m: BuildMessage): void => port.postMessage(m);
  const started = performance.now();
  removeDatabaseFiles(spec.outPath);
  const db = new Database(spec.outPath);
  const workers: Worker[] = [];
  const stop = (): void => { for (const w of workers) void w.terminate(); };
  try {
    // Safe only because the file is discarded on any failure; the swap needs it whole, which close and fsync give
    for (const p of ['page_size = 16384', 'journal_mode = OFF', 'synchronous = OFF', 'cache_size = -262144', 'locking_mode = EXCLUSIVE', 'temp_store = MEMORY']) db.pragma(p);

    const result = await parseAndWrite(db, spec, workers, send);
    stop();
    const parsedAt = performance.now();

    // Tables whose file is stale keep the previous import's rows, marked as such (the owner's decision 5)
    const notCarried: string[] = [];
    if (spec.carryOver.length > 0 && spec.previousPath && fs.existsSync(spec.previousPath)) {
      db.prepare('ATTACH DATABASE ? AS prev').run(spec.previousPath);
      db.pragma('prev.locking_mode = NORMAL');
      for (const table of spec.carryOver) {
        const ddl = db.prepare(`SELECT sql FROM prev.sqlite_master WHERE type = 'table' AND name = ?`).get(table) as { sql: string } | undefined;
        if (!ddl?.sql || result.tables.some((t) => t.table === table)) {
          notCarried.push(table);
          continue;
        }
        db.exec(ddl.sql);
        db.exec(`INSERT INTO main."${table}" SELECT * FROM prev."${table}"`);
        const rows = (db.prepare(`SELECT COUNT(*) AS n FROM main."${table}"`).get() as { n: number }).n;
        const file = spec.files.find((f) => f.table === table)?.file ?? `${table}.csv`;
        result.tables.push({ table, file, rows, source: 'carried' });
      }
      db.exec('DETACH DATABASE prev');
    } else {
      notCarried.push(...spec.carryOver);
    }
    const carriedAt = performance.now();

    send({ type: 'progress', step: { table: 'indexes', fileIndex: spec.files.length, files: spec.files.length, rows: result.rows, phase: 'indexing' } });
    let indexes = 0;
    for (const { table } of result.tables) {
      const columns = new Set((db.prepare(`PRAGMA table_info("${table}")`).all() as Array<{ name: string }>).map((c) => c.name));
      for (const index of indexesFor(table, columns)) {
        try {
          db.exec(`CREATE INDEX "${index.name}" ON "${table}" (${index.columns.map((c) => `"${c}"`).join(', ')})`);
          indexes += 1;
        } catch (err) {
          // A malformed table should not fail the whole import
          console.warn(`[import] index ${index.name} failed:`, (err as Error).message);
        }
      }
    }
    // Lets SQLite pick between the indexes it now has rather than guessing
    db.exec('ANALYZE');
    const indexedAt = performance.now();

    // The database describes its own import, written atomically with it
    db.exec('CREATE TABLE pennant_import (key TEXT PRIMARY KEY, value TEXT)');
    const meta = { ...spec.meta, tables: result.tables, unreadable: result.unreadable, notCarried };
    db.prepare('INSERT INTO pennant_import (key, value) VALUES (?, ?)').run('import', JSON.stringify(meta));

    db.pragma('journal_mode = DELETE');
    db.close();
    // On disk before the rename makes it the league
    const fd = fs.openSync(spec.outPath, 'r+');
    try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }

    const full: BuildResult = {
      ...result,
      notCarried,
      indexes,
      timings: {
        parseAndWriteMs: Math.round(parsedAt - started),
        carryMs: Math.round(carriedAt - parsedAt),
        indexMs: Math.round(indexedAt - carriedAt),
        totalMs: Math.round(performance.now() - started),
      },
    };
    send({ type: 'done', result: full });
  } catch (err) {
    stop();
    try { if (db.open) db.close(); } catch { /* already failing */ }
    removeDatabaseFiles(spec.outPath);
    const e = err as Error & { buildCode?: BuildCode };
    send({ type: 'error', message: e.message, code: e.buildCode ?? 'failed' });
  }
}

type BuildCode = 'export_changed' | 'required_unreadable' | 'row_count' | 'failed';

function fail(message: string, code: BuildCode): Error {
  return Object.assign(new Error(message), { buildCode: code });
}

/** Streams every file through the parse workers into the new database, in one transaction. */
function parseAndWrite(
  db: Database.Database,
  spec: BuildSpec,
  workers: Worker[],
  send: (m: BuildMessage) => void,
): Promise<Omit<BuildResult, 'notCarried' | 'indexes' | 'timings'>> {
  return new Promise((resolve, reject) => {
    const total = spec.files.length;
    // Largest first, so the biggest file never starts last and holds the build up alone
    const queue = [...spec.files].sort((a, b) => b.size - a.size);
    const byFile = new Map<string, ExportFile>(spec.files.map((f) => [f.file, f]));
    const required = new Set(spec.required);
    const tables: BuiltTable[] = [];
    const unreadable: UnreadableFile[] = [];
    const inserts = new Map<string, { stmt: Database.Statement; rows: number }>();
    /** Files left out part way (a header SQLite refused, or a parse failure): their remaining rows are ignored. */
    const skipped = new Map<string, string>();
    let started = 0;
    let done = 0;
    let rows = 0;
    let lastTable = '';
    let lastSent = 0;
    let failed = false;

    const progress = (table: string, phase: ImportStep['phase'], force = false): void => {
      const now = performance.now();
      if (!force && now - lastSent < 50) return;
      lastSent = now;
      send({ type: 'progress', step: { table, fileIndex: Math.max(started, 1), files: total, rows, phase } });
    };
    const abort = (err: Error): void => {
      if (failed) return;
      failed = true;
      reject(err);
    };
    const next = (w: Worker): void => {
      const f = queue.shift();
      if (!f) return;
      started += 1;
      lastTable = f.table;
      progress(f.table, 'reading', true);
      w.postMessage({ file: f.file, filePath: path.join(spec.csvDir, f.file), size: f.size, mtimeMs: f.mtimeMs } satisfies ParseRequest);
    };
    /** Leaves a file out: its table is dropped (absent, never half-written) and it is named as unreadable. */
    const leaveOut = (f: ExportFile, error: string): void => {
      if (required.has(f.table)) throw fail(`${f.file} could not be read: ${error}`, 'required_unreadable');
      console.warn(`[import] Skipping ${f.file}: ${error}`);
      const target = inserts.get(f.table);
      if (target) rows -= target.rows;
      try { db.exec(`DROP TABLE IF EXISTS "${f.table}"`); } catch { /* nothing to drop */ }
      inserts.delete(f.table);
      skipped.set(f.file, error);
    };
    const fileDone = (w: Worker): void => {
      done += 1;
      progress(lastTable, 'writing', true);
      if (done === total) {
        db.exec('COMMIT');
        resolve({ tables, unreadable, rows });
      } else next(w);
    };

    db.exec('BEGIN');
    const count = Math.max(1, Math.min(spec.parseWorkers, total));
    for (let i = 0; i < count; i++) {
      const w = new Worker(new URL(import.meta.url), { workerData: { role: 'parse' } });
      workers.push(w);
      w.on('error', (err) => abort(err));
      w.on('message', (m: ParseOut) => {
        if (failed) return;
        try {
          const f = byFile.get(m.file)!;
          switch (m.kind) {
            case 'header': {
              const columns = m.header.map((h) => `"${h}"`).join(', ');
              try {
                db.exec(`CREATE TABLE "${f.table}" (${columns})`);
                inserts.set(f.table, { stmt: db.prepare(`INSERT INTO "${f.table}" VALUES (${m.header.map(() => '?').join(', ')})`), rows: 0 });
              } catch (err) {
                // A header SQLite will not take (two columns of one name): the file is unreadable, not the import
                leaveOut(f, (err as Error).message);
              }
              break;
            }
            case 'rows': {
              if (skipped.has(f.file)) {
                w.postMessage({ ack: true });
                break;
              }
              const target = inserts.get(f.table)!;
              for (const r of m.rows) target.stmt.run(r);
              target.rows += m.rows.length;
              rows += m.rows.length;
              w.postMessage({ ack: true });
              progress(f.table, 'writing');
              break;
            }
            case 'end': {
              const skippedWhy = skipped.get(f.file);
              if (skippedWhy !== undefined) {
                unreadable.push({ table: f.table, file: f.file, error: skippedWhy });
              } else {
                const target = inserts.get(f.table);
                // An empty file (no header row) is no table, as before
                if (target) {
                  if (target.rows !== m.rows) throw fail(`${f.file}: ${m.rows} rows read but ${target.rows} written`, 'row_count');
                  tables.push({ table: f.table, file: f.file, rows: target.rows, source: 'export' });
                }
              }
              fileDone(w);
              break;
            }
            case 'changed':
              throw fail(`${f.file} changed while it was being read: OOTP is still writing the export`, 'export_changed');
            case 'failed': {
              if (!skipped.has(f.file)) leaveOut(f, m.error);
              unreadable.push({ table: f.table, file: f.file, error: skipped.get(f.file) ?? m.error });
              fileDone(w);
              break;
            }
          }
        } catch (err) {
          abort(err as Error);
        }
      });
      next(w);
    }
  });
}

if (!isMainThread) {
  const role = (workerData as { role?: string } | null)?.role;
  if (role === 'parse') runParser();
  else if (role === 'build') void runBuild((workerData as { spec: BuildSpec }).spec);
}
