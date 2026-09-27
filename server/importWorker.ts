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
/**
 * Columns that hold a name are kept as the export wrote them, never read as a number: a last name of "1013" stored as
 * a number came back as "1013.0" in every sentence that names him (N6 B1 review).
 */
export const NAME_COLUMN = /^(first_name|last_name|middle_name|nick_name|nickname|name|short_name|abbr)$/i;
/** Rows per message from a parser to the writer. */
const BATCH = 5000;
/** Batches a parser may have in flight before it waits for the writer. */
const CREDITS = 3;
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

/**
 * One piece of work for a parse worker: a whole file, or one part of a large file that holds no quote character
 * (`splitPoints`). A part is a run of whole lines; part 0 starts at the header row, a later part is told the header.
 */
type ParseRequest = {
  file: string;
  filePath: string;
  size: number;
  mtimeMs: number;
  part: number;
  /** A part of a split file: its byte range, and the file's shape as the build read it from the whole file. */
  range?: { start: number; end: number; encoding: BufferEncoding; delimiter: string; header: string[] };
};
type ParseOut =
  | { kind: 'header'; file: string; part: number; header: string[] }
  /**
   * A batch of rows, flat: `count` rows of the header's width, one after another (cheaper to pass between threads). A
   * part of a split file puts each row's rowid first (part × 2^32 + its line within the part), so the table keeps the
   * file's order however the parts interleave.
   */
  | { kind: 'rows'; file: string; part: number; values: unknown[]; count: number; withRowid: boolean }
  | { kind: 'end'; file: string; part: number; rows: number }
  | { kind: 'changed'; file: string; part: number }
  | { kind: 'failed'; file: string; part: number; error: string };

const sameFile = (a: fs.Stats, b: fs.Stats): boolean => a.size === b.size && a.mtimeMs === b.mtimeMs && a.ino === b.ino;

/**
 * Reads a file (whole, or one byte range of it) and checks it is the one the listing saw, unchanged while it was read;
 * null when it changed.
 */
function readChecked(filePath: string, size: number, mtimeMs: number, range?: { start: number; end: number }): Buffer | null {
  let fd: number;
  try {
    fd = fs.openSync(filePath, 'r');
  } catch (err) {
    // Gone between the listing and the read: OOTP is writing the export
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
  try {
    const before = fs.fstatSync(fd);
    // Not the file the listing saw: OOTP wrote it since
    if (before.size !== size || before.mtimeMs !== mtimeMs) return null;
    let buf: Buffer;
    if (range) {
      buf = Buffer.allocUnsafe(range.end - range.start);
      let got = 0;
      while (got < buf.length) {
        const n = fs.readSync(fd, buf, got, buf.length - got, range.start + got);
        if (n === 0) return null;
        got += n;
      }
    } else {
      buf = fs.readFileSync(fd);
    }
    const after = fs.fstatSync(fd);
    // Written while it was read, or replaced under its name
    if (!sameFile(before, after) || !sameFile(before, fs.statSync(filePath))) return null;
    return buf;
  } finally {
    fs.closeSync(fd);
  }
}

/** A file's text encoding and delimiter, decided on the whole file as the importer always has. */
function fileShape(buf: Buffer): { encoding: BufferEncoding; delimiter: string; headerEnd: number } {
  // OOTP exports can be Latin-1 (accented names); a file that is not valid UTF-8 is read as Latin-1
  const encoding: BufferEncoding = isUtf8(buf) ? 'utf8' : 'latin1';
  const newline = buf.indexOf(0x0a);
  const headerEnd = newline === -1 ? buf.length : newline;
  return { encoding, delimiter: detectDelimiter(buf.subarray(0, headerEnd).toString(encoding)), headerEnd };
}

/** The header row of a file with no quote character: its first line split on the delimiter (what the parser gives). */
function plainHeader(buf: Buffer, shape: ReturnType<typeof fileShape>): string[] {
  return buf.subarray(0, shape.headerEnd).toString(shape.encoding).replace(/\r$/, '').split(shape.delimiter)
    .map((h, i) => sanitizeIdent(h.trim() || `col_${i}`));
}

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

  async function parseOne(req: ParseRequest): Promise<void> {
    const { file, part } = req;
    let buf: Buffer | null;
    try {
      buf = readChecked(req.filePath, req.size, req.mtimeMs, req.range);
    } catch (err) {
      return post({ kind: 'failed', file, part, error: (err as Error).message });
    }
    if (!buf) return post({ kind: 'changed', file, part });
    // A part of a split file reads only its own lines and is told the file's shape; a whole file decides its own
    const shape = req.range ?? fileShape(buf);
    const start = 0;
    const end = buf.length;
    // A later part is told its header; part 0 (or a whole file) reads it as its first record
    let header: string[] | null = req.range && part > 0 ? req.range.header : null;
    /** Which of the header's columns hold a name (kept as text). */
    let names: boolean[] | null = null;
    if (header) post({ kind: 'header', file, part, header });
    let batch: unknown[] = [];
    let batchRows = 0;
    let rows = 0;
    const withRowid = !!req.range;
    const rowidBase = part * 2 ** 32;
    const onRecord = (record: string[]): void => {
      if (!header) {
        header = record.map((h, i) => sanitizeIdent(h.trim() || `col_${i}`));
        post({ kind: 'header', file, part, header });
        return;
      }
      const cols = header.length;
      if (!names || names.length !== cols) names = header.map((h) => NAME_COLUMN.test(h));
      if (withRowid) batch.push(rowidBase + rows + 1);
      for (let i = 0; i < cols; i++) {
        const v = record[i];
        batch.push(v === undefined || v === '' ? null : !names[i] && NUMERIC.test(v) ? Number(v) : v);
      }
      batchRows += 1;
      rows += 1;
      if (batchRows === BATCH) {
        credits -= 1;
        post({ kind: 'rows', file, part, values: batch, count: batchRows, withRowid });
        batch = [];
        batchRows = 0;
      }
    };
    try {
      /*
       * Records are taken synchronously as the parser makes them (an async iterator per record cost more than the
       * parse). The feed waits before each slice while the writer has `CREDITS` batches unacknowledged, so memory stays
       * bounded by what one slice can produce beyond that.
       */
      const parser = parse({ delimiter: shape.delimiter, encoding: shape.encoding, relax_column_count: true, relax_quotes: true, skip_empty_lines: true });
      const finished = new Promise<void>((resolve, reject) => {
        parser.on('readable', () => {
          let record: string[] | null;
          while ((record = parser.read() as string[] | null) !== null) onRecord(record);
        });
        parser.once('end', resolve);
        parser.once('error', reject);
      });
      for (let at = start; at < end; at += SLICE) {
        while (credits <= 0) await new Promise<void>((resolve) => { wake = resolve; });
        if (!parser.write(buf.subarray(at, Math.min(at + SLICE, end)))) await new Promise<void>((r) => parser.once('drain', r));
      }
      parser.end();
      await finished;
    } catch (err) {
      return post({ kind: 'failed', file, part, error: (err as Error).message });
    }
    if (batchRows > 0) {
      credits -= 1;
      post({ kind: 'rows', file, part, values: batch, count: batchRows, withRowid });
    }
    post({ kind: 'end', file, part, rows });
  }
}

/** A file this large is split across the parse workers, when it can be split safely. */
const SPLIT_MIN_BYTES = 16 * 1024 * 1024;

/**
 * Where a large file can be cut into runs of whole lines for several parse workers, or null when it cannot. Only a
 * file with no quote character at all is split: then every line break ends a record, and each part parses exactly as
 * the whole file would (the career statistics files, the largest, are all numbers). The header's end is the first cut.
 */
export function splitPoints(buf: Buffer, parts: number): Array<{ start: number; end: number }> | null {
  if (parts < 2 || buf.indexOf(0x22) !== -1) return null;
  const headerEnd = buf.indexOf(0x0a);
  if (headerEnd === -1) return null;
  const out: Array<{ start: number; end: number }> = [];
  let start = 0;
  for (let i = 1; i < parts; i++) {
    const target = Math.max(headerEnd + 1, Math.floor((buf.length * i) / parts));
    const cut = buf.indexOf(0x0a, target);
    if (cut === -1 || cut + 1 >= buf.length) break;
    out.push({ start, end: cut + 1 });
    start = cut + 1;
  }
  out.push({ start, end: buf.length });
  return out.length > 1 ? out : null;
}

// ── Build role ───────────────────────────────────────────────────────────

/** Flushes a finished file to disk before a rename makes it the league. */
function flushFile(file: string): void {
  const fd = fs.openSync(file, 'r+');
  try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}

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
    for (const p of ['page_size = 16384', 'journal_mode = OFF', 'synchronous = OFF', 'cache_size = -65536', 'locking_mode = EXCLUSIVE', 'temp_store = MEMORY']) db.pragma(p);

    const result = await parseAndWrite(db, spec, workers, send);
    stop();
    const parsedAt = performance.now();

    // Tables whose file is stale keep the previous import's rows, marked as such (the owner's decision 5)
    const notCarried: string[] = [];
    if (spec.carryOver.length > 0 && spec.previousPath && fs.existsSync(spec.previousPath)) {
      db.prepare('ATTACH DATABASE ? AS prev').run(spec.previousPath);
      db.pragma('prev.locking_mode = NORMAL');
      // Only from the same save: its leagues, by id and name, as the new export has them (a save deleted and made again
      // in the same folder is another league). Unreadable on either side: not the same, nothing is carried
      const leaguesOf = (schema: string): string | null => {
        try {
          return JSON.stringify(db.prepare(`SELECT league_id, name FROM ${schema}.leagues ORDER BY league_id`).all());
        } catch {
          return null;
        }
      };
      const sameSave = leaguesOf('main') !== null && leaguesOf('main') === leaguesOf('prev');
      for (const table of sameSave ? spec.carryOver : []) {
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
      if (!sameSave) notCarried.push(...spec.carryOver);
      db.exec('DETACH DATABASE prev');
    } else {
      notCarried.push(...spec.carryOver);
    }
    const carriedAt = performance.now();

    send({ type: 'progress', step: { table: 'indexes', fileIndex: spec.files.length, files: spec.files.length, rows: result.rows, phase: 'indexing' } });
    // Each exported table was indexed as its file finished (while the parsers worked on); the carried ones now
    let indexes = result.indexes;
    for (const t of result.tables) if (t.source === 'carried') indexes += indexTable(db, t.table);
    // Lets SQLite pick between the indexes it now has rather than guessing
    db.exec('ANALYZE');
    const indexedAt = performance.now();

    // Durable from here: rollback journal, full syncs, and on macOS a full flush to the drive (F_FULLFSYNC) at the
    // commit below, which the build's own writes skipped (review nit 13)
    db.pragma('journal_mode = DELETE');
    db.pragma('synchronous = FULL');
    db.pragma('fullfsync = ON');
    // The database describes its own import, written atomically with it, and its commit is the flush
    db.exec('CREATE TABLE pennant_import (key TEXT PRIMARY KEY, value TEXT)');
    const meta = { ...spec.meta, tables: result.tables, unreadable: result.unreadable, notCarried };
    db.prepare('INSERT INTO pennant_import (key, value) VALUES (?, ?)').run('import', JSON.stringify(meta));
    db.close();
    // On disk before the rename makes it the league
    flushFile(spec.outPath);

    const full: BuildResult = {
      ...result,
      notCarried,
      indexes,
      timings: {
        parseAndWriteMs: Math.round(parsedAt - started),
        writerBusyMs: Math.round(writerBusyMs),
        indexBusyMs: Math.round(indexBusyMs),
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

/** How long the writer spent inserting and indexing (the rest of the parse phase it waited for the parsers). */
let writerBusyMs = 0;

type BuildCode = 'export_changed' | 'required_unreadable' | 'row_count' | 'failed';

/** How long the writer spent building indexes (inside `writerBusyMs`). */
let indexBusyMs = 0;

/** Builds one table's indexes; returns how many. A malformed table does not fail the import. */
function indexTable(db: Database.Database, table: string): number {
  const from = performance.now();
  try {
    return buildIndexesOf(db, table);
  } finally {
    indexBusyMs += performance.now() - from;
  }
}

function buildIndexesOf(db: Database.Database, table: string): number {
  const columns = new Set((db.prepare(`PRAGMA table_info("${table}")`).all() as Array<{ name: string }>).map((c) => c.name));
  let made = 0;
  for (const index of indexesFor(table, columns)) {
    try {
      db.exec(`CREATE INDEX "${index.name}" ON "${table}" (${index.columns.map((c) => `"${c}"`).join(', ')})`);
      made += 1;
    } catch (err) {
      console.warn(`[import] index ${index.name} failed:`, (err as Error).message);
    }
  }
  return made;
}

function fail(message: string, code: BuildCode): Error {
  return Object.assign(new Error(message), { buildCode: code });
}

/** Streams every file through the parse workers into the new database, in one transaction. */
function parseAndWrite(
  db: Database.Database,
  spec: BuildSpec,
  workers: Worker[],
  send: (m: BuildMessage) => void,
): Promise<Omit<BuildResult, 'notCarried' | 'timings'>> {
  return new Promise((resolve, reject) => {
    const total = spec.files.length;
    const byFile = new Map<string, ExportFile>(spec.files.map((f) => [f.file, f]));
    const required = new Set(spec.required);
    const tables: BuiltTable[] = [];
    const unreadable: UnreadableFile[] = [];
    /** Per table: one row's insert, a many-row insert (fewer statements), each with the rowid first for a split file's parts. */
    type Insert = { one: Database.Statement; many: Database.Statement; perMany: number; width: number };
    const inserts = new Map<string, { plain: Insert; withRowid: Insert; rows: number }>();
    /** Per file: parts not yet reported, the rows its parts read, and why it was left out (a header SQLite refused, a parse failure). */
    const state = new Map<string, { partsLeft: number; rowsRead: number; started: boolean; skipped: string | null }>();
    let started = 0;
    let done = 0;
    let rows = 0;
    let indexes = 0;
    let lastTable = '';
    writerBusyMs = 0;
    indexBusyMs = 0;
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

    // The work: largest first, so the biggest file never starts last and holds the build up alone; a large file with
    // no quote character is cut into parts, one per parse worker, so no single file is the build's floor
    type Job = { f: ExportFile; part: number; range?: ParseRequest['range']; bytes: number };
    const jobs: Job[] = [];
    const parseWorkers = Math.max(1, spec.parseWorkers);
    for (const f of spec.files) {
      let parts: Array<{ start: number; end: number }> | null = null;
      const splitMin = spec.splitMinBytes ?? SPLIT_MIN_BYTES;
      if (f.size >= splitMin && parseWorkers > 1) {
        const buf = readChecked(path.join(spec.csvDir, f.file), f.size, f.mtimeMs);
        if (!buf) return abort(fail(`${f.file} changed while it was being read: OOTP is still writing the export`, 'export_changed'));
        parts = splitPoints(buf, Math.min(parseWorkers, Math.ceil(f.size / splitMin)));
        if (parts) {
          const shape = fileShape(buf);
          const header = plainHeader(buf, shape);
          parts.forEach((p, part) => jobs.push({
            f, part, bytes: p.end - p.start,
            range: { start: p.start, end: p.end, encoding: shape.encoding, delimiter: shape.delimiter, header },
          }));
        }
      }
      state.set(f.file, { partsLeft: parts?.length ?? 1, rowsRead: 0, started: false, skipped: null });
      if (!parts) jobs.push({ f, part: 0, bytes: f.size });
    }
    jobs.sort((a, b) => b.bytes - a.bytes);
    const workerCount = Math.min(parseWorkers, jobs.length);

    const next = (w: Worker): void => {
      const job = jobs.shift();
      if (!job) return;
      const st = state.get(job.f.file)!;
      if (!st.started) {
        st.started = true;
        started += 1;
      }
      lastTable = job.f.table;
      progress(job.f.table, 'reading', true);
      w.postMessage({
        file: job.f.file, filePath: path.join(spec.csvDir, job.f.file), size: job.f.size, mtimeMs: job.f.mtimeMs,
        part: job.part, range: job.range,
      } satisfies ParseRequest);
    };
    /** Leaves a file out: its table is dropped (absent, never half-written) and it is named as unreadable. */
    const leaveOut = (f: ExportFile, error: string): void => {
      if (required.has(f.table)) throw fail(`${f.file} could not be read: ${error}`, 'required_unreadable');
      console.warn(`[import] Skipping ${f.file}: ${error}`);
      const target = inserts.get(f.table);
      if (target) rows -= target.rows;
      try { db.exec(`DROP TABLE IF EXISTS "${f.table}"`); } catch { /* nothing to drop */ }
      inserts.delete(f.table);
      state.get(f.file)!.skipped = error;
    };
    /** One part reported; when it was the file's last, the file is finished (indexed, or named as unreadable). */
    const partDone = (w: Worker, f: ExportFile): void => {
      const st = state.get(f.file)!;
      st.partsLeft -= 1;
      if (st.partsLeft === 0) {
        if (st.skipped !== null) {
          unreadable.push({ table: f.table, file: f.file, error: st.skipped });
        } else {
          const target = inserts.get(f.table);
          // An empty file (no header row) is no table, as before
          if (target) {
            if (target.rows !== st.rowsRead) throw fail(`${f.file}: ${st.rowsRead} rows read but ${target.rows} written`, 'row_count');
            tables.push({ table: f.table, file: f.file, rows: target.rows, source: 'export' });
            // Its indexes now, while the parse workers carry on with the other files (the writer would otherwise wait)
            indexes += indexTable(db, f.table);
          }
        }
        done += 1;
        progress(lastTable, 'writing', true);
      }
      if (done === total) {
        db.exec('COMMIT');
        resolve({ tables, unreadable, rows, indexes });
      } else next(w);
    };

    db.exec('BEGIN');
    if (total === 0) {
      db.exec('COMMIT');
      resolve({ tables, unreadable, rows, indexes });
      return;
    }
    for (let i = 0; i < workerCount; i++) {
      const w = new Worker(new URL(import.meta.url), { workerData: { role: 'parse' } });
      workers.push(w);
      w.on('error', (err) => abort(err));
      w.on('message', (m: ParseOut) => {
        if (failed) return;
        const busyFrom = performance.now();
        try {
          const f = byFile.get(m.file)!;
          const st = state.get(m.file)!;
          switch (m.kind) {
            case 'header': {
              if (st.skipped !== null || inserts.has(f.table)) break; // a later part's copy of a header already taken
              const columns = m.header.map((h) => `"${h}"`).join(', ');
              try {
                db.exec(`CREATE TABLE "${f.table}" (${columns})`);
                const statements = (withRowid: boolean): Insert => {
                  const width = m.header.length + (withRowid ? 1 : 0);
                  const target = withRowid ? `"${f.table}" (rowid, ${columns})` : `"${f.table}"`;
                  const row = `(${new Array(width).fill('?').join(', ')})`;
                  // As many rows per statement as SQLite's variable limit allows, up to 100
                  const perMany = Math.max(1, Math.min(100, Math.floor(30_000 / Math.max(width, 1))));
                  return {
                    one: db.prepare(`INSERT INTO ${target} VALUES ${row}`),
                    many: db.prepare(`INSERT INTO ${target} VALUES ${new Array(perMany).fill(row).join(', ')}`),
                    perMany, width,
                  };
                };
                inserts.set(f.table, { plain: statements(false), withRowid: statements(true), rows: 0 });
              } catch (err) {
                // A header SQLite will not take (two columns of one name): the file is unreadable, not the import
                leaveOut(f, (err as Error).message);
              }
              break;
            }
            case 'rows': {
              w.postMessage({ ack: true });
              if (st.skipped !== null) break;
              const target = inserts.get(f.table)!;
              const insert = m.withRowid ? target.withRowid : target.plain;
              const { width, perMany } = insert;
              let at = 0;
              for (; at + perMany <= m.count; at += perMany) insert.many.run(m.values.slice(at * width, (at + perMany) * width));
              for (; at < m.count; at += 1) insert.one.run(m.values.slice(at * width, (at + 1) * width));
              target.rows += m.count;
              rows += m.count;
              progress(f.table, 'writing');
              break;
            }
            case 'end':
              st.rowsRead += m.rows;
              partDone(w, f);
              break;
            case 'changed':
              throw fail(`${f.file} changed while it was being read: OOTP is still writing the export`, 'export_changed');
            case 'failed':
              if (st.skipped === null) leaveOut(f, m.error);
              partDone(w, f);
              break;
          }
        } catch (err) {
          abort(err as Error);
        }
        writerBusyMs += performance.now() - busyFrom;
      });
      next(w);
    }
  });
}

// ── Upgrade role ─────────────────────────────────────────────────────────

/**
 * The one-time upgrade of a league database an earlier build imported (N3.5): a consistent copy (`VACUUM INTO`, which
 * also takes a write-ahead log's pages and leaves the copy in rollback-journal mode), every index an import now builds,
 * ANALYZE, closed and flushed. The served file is only read; the caller swaps the copy in.
 */
function runUpgrade(spec: { sourcePath: string; outPath: string }): void {
  const port = parentPort!;
  const started = performance.now();
  removeDatabaseFiles(spec.outPath);
  try {
    const source = new Database(spec.sourcePath, { readonly: true, fileMustExist: true });
    try {
      source.prepare('VACUUM INTO ?').run(spec.outPath);
    } finally {
      source.close();
    }
    const db = new Database(spec.outPath);
    let indexes = 0;
    try {
      for (const p of ['journal_mode = OFF', 'synchronous = OFF', 'cache_size = -65536', 'temp_store = MEMORY']) db.pragma(p);
      const have = new Set((db.prepare(`SELECT name FROM sqlite_master WHERE type = 'index'`).all() as Array<{ name: string }>).map((r) => r.name));
      const tables = (db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name <> 'pennant_import'`).all() as Array<{ name: string }>).map((r) => r.name);
      for (const table of tables) {
        const columns = new Set((db.prepare(`PRAGMA table_info("${table.replace(/"/g, '')}")`).all() as Array<{ name: string }>).map((c) => c.name));
        for (const index of indexesFor(table, columns)) {
          if (have.has(index.name)) continue;
          try {
            db.exec(`CREATE INDEX "${index.name}" ON "${table}" (${index.columns.map((c) => `"${c}"`).join(', ')})`);
            indexes += 1;
          } catch (err) {
            console.warn(`[import] index ${index.name} failed:`, (err as Error).message);
          }
        }
      }
      db.exec('ANALYZE');
      db.pragma('journal_mode = DELETE');
      // A last write with full syncs, so the copy reaches the drive (F_FULLFSYNC on macOS) before it is swapped in
      db.pragma('synchronous = FULL');
      db.pragma('fullfsync = ON');
      db.pragma(`user_version = ${Number(db.pragma('user_version', { simple: true })) || 0}`);
    } finally {
      db.close();
    }
    flushFile(spec.outPath);
    port.postMessage({ type: 'done', indexes, ms: Math.round(performance.now() - started) });
  } catch (err) {
    removeDatabaseFiles(spec.outPath);
    port.postMessage({ type: 'error', message: (err as Error).message });
  }
}

if (!isMainThread) {
  const role = (workerData as { role?: string } | null)?.role;
  if (role === 'parse') runParser();
  else if (role === 'build') void runBuild((workerData as { spec: BuildSpec }).spec);
  else if (role === 'upgrade') runUpgrade((workerData as { spec: { sourcePath: string; outPath: string } }).spec);
}
