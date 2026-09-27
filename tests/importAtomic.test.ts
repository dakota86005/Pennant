import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DATA_DIR } from '../server/config.js';
import { databaseGeneration, db, importRecord, leagueDbTiming, NEXT_DB_PATH, prepareLeagueDatabase, retiredConnections, tableExists } from '../server/db.js';
import { diskSpace, importCsvDir, importTiming, ImportRefused, type ImportResult } from '../server/importer.js';
import { buildLeagueDatabase, BuildError } from '../server/importBuild.js';
import { splitPoints } from '../server/importWorker.js';
import { assessFiles, listExport } from '../server/exportFiles.js';

/**
 * The import is all or nothing (D-061, BEHAVIOR_CASES "The import and the export's ratings"): a new file is built in a
 * worker and swapped in with one rename. These hold: readers see the previous import whole until the swap, then the new
 * one whole; a failure at any phase leaves the previous import; a stale or unreadable file is named and never mixed in
 * silently; there must be room; the data folder does not grow over repeated imports; the hot queries use an index; the
 * server's thread stays free.
 */

const scratch: string[] = [];
afterAll(() => { for (const d of scratch) fs.rmSync(d, { recursive: true, force: true }); });
afterEach(() => {
  diskSpace.free = originalFree;
  importTiming.attempts = 3;
});
const originalFree = diskSpace.free;

const BIG = 60_000;

/** An export: the three tables every import needs, a big career table, and a small one. `version` is in every row. */
function writeExport(version: number, opts: { dir?: string; big?: number; extra?: Record<string, string> } = {}): string {
  const dir = opts.dir ?? fs.mkdtempSync(path.join(os.tmpdir(), 'pennant-atomic-'));
  if (!opts.dir) scratch.push(dir);
  const big = opts.big ?? BIG;
  fs.writeFileSync(path.join(dir, 'leagues.csv'), `league_id,name,version\n100,Major,${version}\n`);
  fs.writeFileSync(path.join(dir, 'teams.csv'), `team_id,league_id,name,version\n1,100,Club,${version}\n2,100,Other,${version}\n`);
  fs.writeFileSync(path.join(dir, 'players.csv'), `player_id,team_id,name,version\n1,1,One,${version}\n2,2,Two,${version}\n`);
  const rows = Array.from({ length: big }, (_, i) => `${(i % 500) + 1},${2000 + (i % 30)},${(i % 3) + 1},${version}`).join('\n');
  fs.writeFileSync(path.join(dir, 'players_career_batting_stats.csv'), `player_id,year,split_id,version\n${rows}\n`);
  fs.writeFileSync(path.join(dir, 'games.csv'), `game_id,version\n1,${version}\n`);
  for (const [file, body] of Object.entries(opts.extra ?? {})) fs.writeFileSync(path.join(dir, file), body);
  return dir;
}

const versionsOf = (table: string): { versions: number[]; rows: number } => ({
  versions: (db.prepare(`SELECT DISTINCT version FROM "${table}" ORDER BY version`).all() as Array<{ version: number }>).map((r) => r.version),
  rows: (db.prepare(`SELECT COUNT(*) AS n FROM "${table}"`).get() as { n: number }).n,
});

const backdate = (file: string, minutes: number): void => {
  const at = new Date(Date.now() - minutes * 60_000);
  fs.utimesSync(file, at, at);
};

describe('an import is all or nothing', () => {
  it('shows readers the previous import whole until the swap, then the new one whole, never a mix', async () => {
    await importCsvDir(writeExport(1));
    const before = databaseGeneration();
    const seen: Array<{ generation: number; lo: number; hi: number; rows: number; tables: number }> = [];
    let stop = false;
    const poll = (async () => {
      while (!stop) {
        const r = db.prepare('SELECT MIN(version) AS lo, MAX(version) AS hi, COUNT(*) AS rows FROM players_career_batting_stats').get() as { lo: number; hi: number; rows: number };
        const tables = (db.prepare(`SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table'`).get() as { n: number }).n;
        seen.push({ generation: databaseGeneration(), ...r, tables });
        await new Promise((resolve) => setImmediate(resolve));
      }
    })();
    await importCsvDir(writeExport(2));
    stop = true;
    await poll;
    const old = seen.filter((s) => s.generation === before);
    const fresh = seen.filter((s) => s.generation === before + 1);
    expect(old.length, 'the pages kept being answered while the new file was built').toBeGreaterThan(5);
    for (const s of old) expect(s).toMatchObject({ lo: 1, hi: 1, rows: BIG });
    for (const s of fresh) expect(s).toMatchObject({ lo: 2, hi: 2, rows: BIG });
    expect(versionsOf('players_career_batting_stats')).toEqual({ versions: [2], rows: BIG });
  });

  it('leaves the previous import exactly as it was when a required file cannot be read', async () => {
    await importCsvDir(writeExport(3));
    const generation = databaseGeneration();
    const broken = writeExport(4, { extra: { 'players.csv': 'player_id,name,version\n1,"never closed,4\n' } });
    await expect(importCsvDir(broken)).rejects.toThrow(/players\.csv could not be read/);
    expect(databaseGeneration()).toBe(generation);
    expect(versionsOf('players_career_batting_stats').versions).toEqual([3]);
    expect(versionsOf('players').versions).toEqual([3]);
    expect(fs.existsSync(NEXT_DB_PATH), 'the unfinished file is removed').toBe(false);
  });

  it('reads the export again when a file changes while it is read, and refuses once it keeps changing', async () => {
    await importCsvDir(writeExport(5));
    const dir = writeExport(6);
    const touch = (): void => fs.writeFileSync(path.join(dir, 'games.csv'), 'game_id,version\n1,6\n2,6\n');
    // Rewritten between judging the export and reading it, on the first attempt only: the second reads it whole
    const result = await importCsvDir(dir, { beforeBuild: (attempt) => { if (attempt === 1) touch(); } });
    expect(result.files.find((f) => f.table === 'games')?.rows).toBe(2);
    expect(versionsOf('games').versions).toEqual([6]);

    importTiming.attempts = 1;
    const generation = databaseGeneration();
    await expect(importCsvDir(writeExport(7), { beforeBuild: () => fs.writeFileSync(path.join(dir, 'games.csv'), 'x\n') }))
      .resolves.toBeTruthy(); // another folder's file: this export is unaffected
    const moving = writeExport(8);
    await expect(importCsvDir(moving, { beforeBuild: () => fs.writeFileSync(path.join(moving, 'games.csv'), `game_id,version\n${Date.now()},8\n`) }))
      .rejects.toThrow(/EXPORT_CHANGING/);
    expect(databaseGeneration()).toBe(generation + 1);
    expect(versionsOf('players').versions).toEqual([7]);
  });

  it('never builds from a file other than the one the listing saw (the build\'s own check)', async () => {
    const dir = writeExport(9);
    const files = listExport(dir).map((f) => (f.table === 'games' ? { ...f, mtimeMs: f.mtimeMs - 1000 } : f));
    const out = path.join(DATA_DIR, 'league.check.db');
    await expect(buildLeagueDatabase({ csvDir: dir, outPath: out, previousPath: null, files, carryOver: [], required: ['players'], parseWorkers: 2, meta: {} }))
      .rejects.toSatisfy((err: unknown) => err instanceof BuildError && err.code === 'export_changed');
    expect(fs.existsSync(out)).toBe(false);
  });

  it('removes a crashed import\'s unfinished file at the next start, and leaves the league alone', async () => {
    await importCsvDir(writeExport(10));
    fs.writeFileSync(NEXT_DB_PATH, 'half a database');
    fs.writeFileSync(`${NEXT_DB_PATH}-journal`, 'x');
    expect(prepareLeagueDatabase().removedLeftover).toBe(true);
    expect(fs.existsSync(NEXT_DB_PATH)).toBe(false);
    expect(fs.existsSync(`${NEXT_DB_PATH}-journal`)).toBe(false);
    expect(versionsOf('players').versions).toEqual([10]);
  });

  it('refuses, touching nothing, when there is not room for the new file beside the old one', async () => {
    await importCsvDir(writeExport(11));
    const generation = databaseGeneration();
    diskSpace.free = () => 1024 * 1024; // 1 MB
    const err = await importCsvDir(writeExport(12)).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ImportRefused);
    expect((err as ImportRefused).code).toBe('disk_space');
    expect((err as Error).message).toMatch(/^Not enough free disk space to import: about \S+ GB is needed and 0\.0 GB is free/);
    expect(databaseGeneration()).toBe(generation);
    expect(fs.existsSync(NEXT_DB_PATH)).toBe(false);
    expect(versionsOf('players').versions).toEqual([11]);
  });
});

describe('a file older than the rest of the export', () => {
  it('is left out and named; its table keeps the previous import\'s rows, marked, when that import read the same folder', async () => {
    const dir = writeExport(20, { extra: { 'players_game_batting.csv': 'player_id,game_id,version\n1,1,20\n1,2,20\n' } });
    const first = await importCsvDir(dir);
    expect(versionsOf('players_game_batting')).toEqual({ versions: [20], rows: 2 });

    // The next export rewrites every file but this one (a table switched off in OOTP's export settings)
    writeExport(21, { dir });
    backdate(path.join(dir, 'players_game_batting.csv'), 60);
    const second = await importCsvDir(dir);
    expect(second.leftOut).toEqual([expect.objectContaining({ table: 'players_game_batting', reason: 'stale', kept: true, keptFrom: first.startedAt })]);
    expect(second.files.map((f) => f.table)).not.toContain('players_game_batting');
    // Kept: exactly the rows the previous import read, and the database says which import they came from
    expect(versionsOf('players_game_batting')).toEqual({ versions: [20], rows: 2 });
    expect(versionsOf('players').versions).toEqual([21]);
    const record = importRecord()!;
    expect(record.keptFrom).toEqual({ players_game_batting: first.startedAt });
    expect((record.tables as Array<{ table: string; source: string }>).find((t) => t.table === 'players_game_batting')?.source).toBe('carried');

    // Another import later: still kept, still from the first import
    writeExport(22, { dir });
    backdate(path.join(dir, 'players_game_batting.csv'), 60);
    const third = await importCsvDir(dir);
    expect(third.leftOut?.[0]).toMatchObject({ kept: true, keptFrom: first.startedAt });
  });

  it('leaves its table absent when the previous import read another export (never another save\'s rows)', async () => {
    await importCsvDir(writeExport(30, { extra: { 'players_game_batting.csv': 'player_id,game_id,version\n1,1,30\n' } }));
    const other = writeExport(31, { extra: { 'players_game_batting.csv': 'player_id,game_id,version\n1,1,31\n' } });
    backdate(path.join(other, 'players_game_batting.csv'), 60);
    const result = await importCsvDir(other);
    expect(result.leftOut).toEqual([expect.objectContaining({ table: 'players_game_batting', reason: 'stale', kept: false, keptFrom: null })]);
    expect(tableExists('players_game_batting')).toBe(false);
  });

  it('leaves its table absent when the previous import was of another save in the same folder (other leagues)', async () => {
    const dir = writeExport(35, { extra: { 'players_game_batting.csv': 'player_id,game_id,version\n1,1,35\n' } });
    await importCsvDir(dir);
    writeExport(36, { dir });
    fs.writeFileSync(path.join(dir, 'leagues.csv'), 'league_id,name,version\n100,Another League,36\n');
    backdate(path.join(dir, 'players_game_batting.csv'), 60);
    const result = await importCsvDir(dir);
    expect(result.leftOut).toEqual([expect.objectContaining({ table: 'players_game_batting', reason: 'stale', kept: false })]);
    expect(tableExists('players_game_batting')).toBe(false);
  });

  it('refuses the import when it is players, clubs or leagues, and keeps the previous import', async () => {
    const dir = writeExport(40);
    await importCsvDir(dir);
    writeExport(41, { dir });
    backdate(path.join(dir, 'teams.csv'), 60);
    await expect(importCsvDir(dir)).rejects.toThrow(/^STALE_REQUIRED: teams/);
    expect(versionsOf('players').versions).toEqual([40]);
  });

  it('a file that cannot be read leaves its table absent, never the previous rows', async () => {
    const dir = writeExport(50, { extra: { 'coaches.csv': 'coach_id,version\n1,50\n' } });
    await importCsvDir(dir);
    writeExport(51, { dir, extra: { 'coaches.csv': 'coach_id,version\n1,"never closed\n' } });
    const result = await importCsvDir(dir);
    expect(result.leftOut).toEqual([expect.objectContaining({ table: 'coaches', reason: 'unreadable', kept: false })]);
    expect(tableExists('coaches')).toBe(false);
  });
});

describe('the data folder over repeated imports', () => {
  const folderBytes = (): number => fs.readdirSync(DATA_DIR).reduce((n, f) => {
    const st = fs.statSync(path.join(DATA_DIR, f));
    return st.isFile() ? n + st.size : n;
  }, 0);

  it('stays the same size: the old file goes with the swap, and nothing is left behind', async () => {
    leagueDbTiming.retireMs = 0;
    const pending = retiredConnections(); // earlier cases' replaced connections, still in their grace
    try {
      const dir = writeExport(60);
      const sizes: number[] = [];
      let names: string[] | null = null;
      for (let i = 0; i < 8; i++) {
        writeExport(60 + i, { dir });
        await importCsvDir(dir);
        await new Promise((r) => setTimeout(r, 5)); // the replaced connection closes
        sizes.push(folderBytes());
        const now = fs.readdirSync(DATA_DIR).filter((f) => !f.startsWith('history.db')).sort();
        if (names) expect(now).toEqual(names);
        names = now;
      }
      // Every connection these imports replaced has closed (and given its file's space back)
      expect(retiredConnections()).toBeLessThanOrEqual(pending);
      // The listing cannot see a replaced file still held open; lsof can (unlinked files this process holds), where it exists
      const lsof = spawnSync('lsof', ['-a', '-p', String(process.pid), '+L1'], { encoding: 'utf8' });
      if (!lsof.error) {
        // One file each (an open file and its memory map are two lines of one inode): NODE is the column before NAME
        const lines = lsof.stdout.split('\n').filter((line) => line.includes(DATA_DIR) && /league/.test(line));
        const held = new Set(lines.map((line) => line.trim().split(/\s+/).slice(-2)[0]));
        expect(held.size, lines.join('\n')).toBeLessThanOrEqual(pending);
      }
      expect(fs.existsSync(NEXT_DB_PATH)).toBe(false);
      expect(Math.max(...sizes) / Math.min(...sizes)).toBeLessThan(1.1);
    } finally {
      leagueDbTiming.retireMs = 5_000;
    }
  });
});

describe('the served database', () => {
  it('answers the hot season queries from an index, not a scan', async () => {
    await importCsvDir(writeExport(70));
    const plan = (sql: string, ...args: unknown[]): string =>
      (db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...args) as Array<{ detail: string }>).map((r) => r.detail).join(' | ');
    expect(plan('SELECT MAX(year) FROM players_career_batting_stats')).toMatch(/USING (COVERING )?INDEX idx_players_career_batting_stats_year_split/);
    expect(plan('SELECT * FROM players_career_batting_stats WHERE year = ? AND split_id = 1', 2010)).toMatch(/USING INDEX idx_players_career_batting_stats_year_split/);
    expect(plan('SELECT * FROM players_career_batting_stats WHERE player_id = ?', 7)).toMatch(/USING INDEX idx_players_career_batting_stats_(player_id|year_split)/);
  });

  it('records its own import inside it, with what the import left out', async () => {
    const result: ImportResult = await importCsvDir(writeExport(80));
    const record = importRecord()!;
    expect(record).toMatchObject({ startedAt: result.startedAt, exportFingerprint: result.exportFingerprint });
    expect((record.tables as unknown[]).length).toBe(result.tables);
  });

  it('keeps the server\'s thread free while the new file is built', async () => {
    await importCsvDir(writeExport(90));
    const gaps: number[] = [];
    let last = performance.now();
    const timer = setInterval(() => {
      const now = performance.now();
      gaps.push(now - last);
      last = now;
    }, 5);
    await importCsvDir(writeExport(91, { big: 200_000 }));
    clearInterval(timer);
    gaps.sort((a, b) => a - b);
    const p95 = gaps[Math.floor(gaps.length * 0.95)];
    expect(gaps.length).toBeGreaterThan(10);
    // Generous bounds (CI hardware varies): the old import held the thread for seconds at a time
    expect(p95, `p95 ${p95.toFixed(0)} ms`).toBeLessThan(100);
    expect(gaps[gaps.length - 1], `worst ${gaps[gaps.length - 1].toFixed(0)} ms`).toBeLessThan(250);
  });
});

describe('a large file split across the parse workers', () => {
  const build = async (dir: string, splitMinBytes?: number): Promise<Array<Record<string, unknown>>> => {
    const out = path.join(DATA_DIR, `league.split-${splitMinBytes ?? 'whole'}.db`);
    await buildLeagueDatabase({ csvDir: dir, outPath: out, previousPath: null, files: listExport(dir), carryOver: [], required: [], parseWorkers: 3, meta: {}, splitMinBytes });
    const Database = (await import('better-sqlite3')).default;
    const conn = new Database(out, { readonly: true });
    try {
      return conn.prepare('SELECT * FROM big').all() as Array<Record<string, unknown>>;
    } finally {
      conn.close();
      fs.rmSync(out, { force: true });
    }
  };

  it('reads exactly as the whole file would, in the file\'s order, when the file has no quote character', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pennant-split-'));
    scratch.push(dir);
    const rows = Array.from({ length: 5000 }, (_, i) => `${i},${(i * 7) % 13},${i % 2 ? '' : 'x'}${i}`).join('\r\n');
    fs.writeFileSync(path.join(dir, 'big.csv'), `id,n,label\r\n${rows}\r\n`);
    const whole = await build(dir);
    const split = await build(dir, 4096);
    expect(split).toHaveLength(5000);
    expect(split).toEqual(whole);
    expect(split[0]).toEqual({ id: 0, n: 0, label: 'x0' });
    expect(split[4999]).toMatchObject({ id: 4999 });
  });

  it('is cut only at line breaks, the header in the first part', () => {
    const buf = Buffer.from(`a,b\n${Array.from({ length: 100 }, (_, i) => `${i},${i}`).join('\n')}\n`);
    const parts = splitPoints(buf, 3)!;
    expect(parts).toHaveLength(3);
    expect(parts[0].start).toBe(0);
    expect(parts[2].end).toBe(buf.length);
    for (let i = 1; i < parts.length; i++) {
      expect(parts[i].start).toBe(parts[i - 1].end);
      expect(buf[parts[i].start - 1]).toBe(0x0a);
    }
    expect(splitPoints(Buffer.from('a,b\n1,"x"\n2,y\n'), 2)).toBeNull();
  });

  it('is never split when it holds a quote character (a quoted field may hold a line break)', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pennant-split-'));
    scratch.push(dir);
    const rows = Array.from({ length: 3000 }, (_, i) => (i === 1500 ? `${i},"two\nlines"` : `${i},plain`)).join('\n');
    fs.writeFileSync(path.join(dir, 'big.csv'), `id,label\n${rows}\n`);
    const split = await build(dir, 1024);
    expect(split).toHaveLength(3000);
    expect(split[1500]).toEqual({ id: 1500, label: 'two\nlines' });
  });
});

describe('an export OOTP paused part way through (N3.5 review, finding 2)', () => {
  const setTime = (dir: string, files: string[], msAgo: number): void => {
    const at = new Date(Date.now() - msAgo);
    for (const f of files) fs.utimesSync(path.join(dir, f), at, at);
  };
  const EARLY = ['leagues.csv', 'teams.csv', 'players.csv'];
  const LATE = ['players_career_batting_stats.csv', 'games.csv'];
  /** Export 2 written part way: the early files new, the late ones still export 1's, from a few minutes before. */
  const partWritten = (dir: string, newAgoMs: number, oldAgoMs: number): void => {
    writeExport(1, { dir });
    setTime(dir, [...EARLY, ...LATE], oldAgoMs);
    for (const f of EARLY) fs.writeFileSync(path.join(dir, f), fs.readFileSync(path.join(dir, f), 'utf8').replaceAll(',1\n', ',2\n'));
    setTime(dir, EARLY, newAgoMs);
  };
  afterEach(() => { importTiming.settleTimeoutMs = 200_000; });

  it('is never imported while its files fall in groups minutes apart: the import waits, and the previous one stays', async () => {
    const dir = writeExport(1);
    await importCsvDir(dir);
    partWritten(dir, 1_000, 5 * 60_000);
    importTiming.settleTimeoutMs = 300;
    await expect(importCsvDir(dir)).rejects.toThrow(/^EXPORT_CHANGING/);
    expect(versionsOf('players').versions).toEqual([1]);
    expect(versionsOf('players_career_batting_stats').versions).toEqual([1]);
    // OOTP finishes: every file from one burst, all export 2
    writeExport(2, { dir });
    const done = await importCsvDir(dir);
    expect(done.leftOut).toEqual([]);
    for (const t of ['leagues', 'teams', 'players', 'players_career_batting_stats', 'games']) expect(versionsOf(t).versions, t).toEqual([2]);
  });

  it('when it never finishes, names the older group as not rewritten (never mixed silently) once the newer has long been quiet', async () => {
    const dir = writeExport(1);
    const first = await importCsvDir(dir);
    partWritten(dir, 3 * 60_000, 8 * 60_000);
    const result = await importCsvDir(dir);
    expect(result.leftOut?.map((l) => [l.table, l.reason, l.kept, l.keptFrom])).toEqual([
      ['games', 'stale', true, first.startedAt],
      ['players_career_batting_stats', 'stale', true, first.startedAt],
    ]);
    expect(versionsOf('players').versions).toEqual([2]);
  });

  it('refuses when the older group holds players, clubs or leagues', async () => {
    const dir = writeExport(1);
    await importCsvDir(dir);
    writeExport(1, { dir });
    setTime(dir, ['players.csv'], 8 * 60_000);
    setTime(dir, ['leagues.csv', 'teams.csv', ...LATE], 3 * 60_000);
    await expect(importCsvDir(dir)).rejects.toThrow(/^STALE_REQUIRED: players/);
  });

  it('reads the export again when anything in the folder changed during the build, even a file it did not read', async () => {
    const dir = writeExport(3);
    await importCsvDir(dir);
    writeExport(4, { dir });
    const late = (attempt: number): void => { if (attempt === 1) fs.writeFileSync(path.join(dir, 'zz_late.csv'), 'id\n1\n'); };
    const result = await importCsvDir(dir, { beforeBuild: late });
    expect(result.files.map((f) => f.table)).toContain('zz_late');
    importTiming.attempts = 1;
    await expect(importCsvDir(dir, { beforeBuild: () => fs.writeFileSync(path.join(dir, 'zz_later.csv'), `id\n${Date.now()}\n`) }))
      .rejects.toThrow(/^EXPORT_CHANGING/);
  });

  it('judges groups by the gaps between files, and says how long until it would settle', () => {
    const t = 5_000_000_000;
    const f = (name: string, ms: number) => ({ file: `${name}.csv`, table: name, size: 1, mtimeMs: ms });
    const oneBurst = assessFiles([f('a', t), f('b', t + 7_000), f('c', t + 14_000)], t + 20_000);
    expect(oneBurst).toMatchObject({ clustered: false, settled: true, settlesInMs: 0 });
    const grouped = assessFiles([f('a', t), f('b', t + 4 * 60_000), f('c', t + 4 * 60_000 + 5_000)], t + 4 * 60_000 + 5_000 + 30_000);
    expect(grouped).toMatchObject({ clustered: true, settled: false, settlesInMs: 90_000 });
    expect(grouped.current.map((x) => x.table)).toEqual(['a', 'b', 'c']);
    const settledGroups = assessFiles(grouped.files, t + 4 * 60_000 + 5_000 + 120_000);
    expect(settledGroups).toMatchObject({ clustered: true, settled: true });
    expect(settledGroups.stale.map((x) => x.table)).toEqual(['a']);
  });
});

describe('the database\'s own record of its import (N3.5 review, finding 3)', () => {
  it('is trusted only as the last import\'s: after the earlier build imports into the same file, it is treated as absent', async () => {
    const { forgetImportRecord, LAST_IMPORT_PATH } = await import('../server/db.js');
    const { previousFromDatabase } = await import('../server/importer.js');
    const result = await importCsvDir(writeExport(100));
    expect(importRecord()).toMatchObject({ startedAt: result.startedAt });
    expect(previousFromDatabase()).not.toBeNull();
    // The earlier (Electron) build imports in place: it rewrites last-import.json and leaves pennant_import behind
    fs.writeFileSync(LAST_IMPORT_PATH, JSON.stringify({ tables: 5, rows: 1, startedAt: '2099-01-01T00:00:00.000Z', finishedAt: '2099-01-01T00:00:10.000Z', files: [] }));
    forgetImportRecord();
    expect(importRecord()).toBeNull();
    expect(previousFromDatabase()).toBeNull();
  });
});

describe('a swap whose rename is refused while another handle holds the file (Windows; N3.5 review, finding 8)', () => {
  it('waits without blocking the server, serving the previous import meanwhile, then swaps', async () => {
    const { swapWhenFree } = await import('../server/db.js');
    await importCsvDir(writeExport(110));
    const next = path.join(DATA_DIR, 'league.held.db');
    fs.rmSync(next, { force: true });
    db.exec(`VACUUM INTO '${next.replaceAll("'", "''")}'`);
    const platform = Object.getOwnPropertyDescriptor(process, 'platform')!;
    Object.defineProperty(process, 'platform', { value: 'win32' });
    const realRename = fs.renameSync;
    let refused = 0;
    const spy = vi.spyOn(fs, 'renameSync').mockImplementation((from, to) => {
      if (refused < 3) {
        refused += 1;
        throw Object.assign(new Error('resource busy'), { code: 'EBUSY' });
      }
      realRename(from, to);
    });
    let ticks = 0;
    let servedMeanwhile = 0;
    const timer = setInterval(() => {
      ticks += 1;
      if ((db.prepare('SELECT COUNT(*) AS n FROM players').get() as { n: number }).n === 2) servedMeanwhile += 1;
    }, 20);
    const generation = databaseGeneration();
    let thenRan = false;
    try {
      await swapWhenFree(next, () => { thenRan = true; });
    } finally {
      clearInterval(timer);
      spy.mockRestore();
      Object.defineProperty(process, 'platform', platform);
    }
    expect(refused).toBe(3);
    expect(thenRan).toBe(true);
    expect(databaseGeneration()).toBe(generation + 1);
    // About 1.5 s of waiting, with the server's thread free and the previous import served throughout
    expect(ticks).toBeGreaterThan(20);
    expect(servedMeanwhile).toBeGreaterThan(20);
  });
});
