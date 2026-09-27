import { afterAll, afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DATA_DIR } from '../server/config.js';
import { databaseGeneration, db, importRecord, leagueDbTiming, NEXT_DB_PATH, prepareLeagueDatabase, retiredConnections, tableExists } from '../server/db.js';
import { diskSpace, importCsvDir, importTiming, ImportRefused, type ImportResult } from '../server/importer.js';
import { buildLeagueDatabase, BuildError } from '../server/importBuild.js';
import { listExport } from '../server/exportFiles.js';

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
