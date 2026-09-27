import { afterAll, afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { upgradeLeagueInBackground, upgradeRoom } from '../server/api.js';
import { databaseGeneration, NEXT_DB_PATH } from '../server/db.js';
import { diskSpace } from '../server/importer.js';

/**
 * The N3.5 re-review's follow-ups to the import (Stage B2), each held by a test that failed before its fix.
 */
const scratch: string[] = [];
const originalFree = diskSpace.free;
afterEach(() => { diskSpace.free = originalFree; });
afterAll(() => { for (const d of scratch) fs.rmSync(d, { recursive: true, force: true }); });
export const tempDir = (prefix: string): string => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  scratch.push(dir);
  return dir;
};

describe('the one-time upgrade of an earlier build\'s league database', () => {
  it('checks for room for its copy first (1.5 times the file), and without it writes nothing and swaps nothing', async () => {
    const generation = databaseGeneration();
    diskSpace.free = () => 1024; // 1 KB
    await upgradeLeagueInBackground();
    expect(databaseGeneration()).toBe(generation);
    expect(fs.existsSync(NEXT_DB_PATH)).toBe(false);
    expect(upgradeRoom()).toMatch(/^Not enough free disk space to bring the league database up to date: about \S+ GB is needed and 0\.0 GB is free\. It is served as it is, and Pennant checks again at the next start\.$/);
    // With room, it runs
    diskSpace.free = () => 1024 ** 4;
    expect(upgradeRoom()).toBeNull();
    await upgradeLeagueInBackground();
    expect(databaseGeneration()).toBe(generation + 1);
  });
});

describe('the export watch', () => {
  it('looks at the folder every minute besides the file watch, so an export is still noticed when the watch has dropped', async () => {
    const { PERIODIC_CHECK_MS, onSettledExport, startWatcher, stopWatcher, watchClock } = await import('../server/watcher.js');
    const { handleSettledExport } = await import('../server/api.js');
    const dir = tempDir('pennant-periodic-');
    const intervals: Array<{ fn: () => void; ms: number }> = [];
    const saved = { ...watchClock };
    Object.assign(watchClock, {
      setInterval: (fn: () => void, ms: number) => { intervals.push({ fn, ms }); return intervals.length as unknown as ReturnType<typeof setInterval>; },
      clearInterval: () => {},
    });
    const seen: string[] = [];
    onSettledExport((_dir, assessment) => seen.push(assessment.fingerprint ?? ''));
    try {
      startWatcher(dir);
      // OOTP writes an export and the watch reports nothing (it dropped): only the look every minute can find it
      fs.writeFileSync(path.join(dir, 'players.csv'), 'player_id\n1\n');
      const past = new Date(Date.now() - 60_000);
      fs.utimesSync(path.join(dir, 'players.csv'), past, past);
      expect(intervals.map((i) => i.ms)).toEqual([PERIODIC_CHECK_MS]);
      intervals[0].fn();
      expect(seen).toHaveLength(1);
    } finally {
      stopWatcher();
      Object.assign(watchClock, saved);
      onSettledExport(handleSettledExport);
    }
  });
});

describe('an export written within a minute of the last one imported from the same folder (closing D-061\'s window)', () => {
  it('names a file no newer than the last import\'s export as not rewritten, and waits as for an export in groups', async () => {
    const { assessFiles } = await import('../server/exportFiles.js');
    const t = 5_000_000_000;
    const f = (name: string, ms: number) => ({ file: `${name}.csv`, table: name, size: 1, mtimeMs: ms });
    // The last import read an export whose newest file was written at t; OOTP rewrites a and b 40 s later, not c
    const files = [f('a', t + 40_000), f('b', t + 40_500), f('c', t)];
    // Without knowing the last import: one burst (40 s apart), settled after the quiet period, c read as new
    expect(assessFiles(files, t + 55_000)).toMatchObject({ clustered: false, settled: true });
    // Knowing it: c was not rewritten, so the export is judged in groups and waited on
    const waiting = assessFiles(files, t + 55_000, t);
    expect(waiting).toMatchObject({ clustered: true, settled: false });
    const settled = assessFiles(files, t + 40_500 + 120_000, t);
    expect(settled).toMatchObject({ clustered: true, settled: true });
    expect(settled.stale.map((x) => x.table)).toEqual(['c']);
    expect(settled.current.map((x) => x.table)).toEqual(['a', 'b']);
    // Nothing rewritten (the same export again): judged as before
    expect(assessFiles([f('a', t), f('b', t)], t + 20_000, t)).toMatchObject({ clustered: false, settled: true, stale: [] });
  });

  it('never imports the mix: the import waits, and the previous import stays whole', async () => {
    const { importCsvDir, importTiming } = await import('../server/importer.js');
    const served = await import('../server/db.js'); // read `served.db` at call time: a live binding, swapped by an import
    const dir = tempDir('pennant-window-');
    const write = (file: string, version: number): void => {
      fs.writeFileSync(path.join(dir, file), file === 'leagues.csv' ? `league_id,version\n100,${version}\n`
        : file === 'teams.csv' ? `team_id,version\n1,${version}\n` : file === 'players.csv' ? `player_id,version\n1,${version}\n` : `game_id,version\n1,${version}\n`);
    };
    const at = (file: string, ms: number): void => fs.utimesSync(path.join(dir, file), new Date(ms), new Date(ms));
    const t0 = Math.floor(Date.now() / 1000) * 1000 - 55_000;
    for (const file of ['leagues.csv', 'teams.csv', 'players.csv', 'games.csv']) { write(file, 1); at(file, t0); }
    await importCsvDir(dir);
    // OOTP writes the next export 40 s later and pauses 15 s before games.csv: it is still the last export's
    for (const file of ['leagues.csv', 'teams.csv', 'players.csv']) { write(file, 2); at(file, t0 + 40_000); }
    importTiming.settleTimeoutMs = 300;
    try {
      await expect(importCsvDir(dir)).rejects.toThrow(/^EXPORT_CHANGING/);
    } finally {
      importTiming.settleTimeoutMs = 200_000;
    }
    expect((served.db.prepare('SELECT DISTINCT version FROM players').all() as Array<{ version: number }>).map((r) => r.version)).toEqual([1]);
  });
});

describe('a swap over a league file with a hot rollback journal (a process killed while writing it in place)', () => {
  it('rolls the journal back into the file before the rename, never deletes it: a failed rename leaves the previous import whole', async () => {
    const { spawnSync } = await import('node:child_process');
    const { createRequire } = await import('node:module');
    const Database = (await import('better-sqlite3')).default;
    const served = await import('../server/db.js');
    const file = served.LEAGUE_DB_PATH;
    served.db.exec(`CREATE TABLE hot_case (v INTEGER, pad TEXT)`);
    served.db.prepare(`INSERT INTO hot_case SELECT 1, hex(randomblob(200)) FROM (WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 20000) SELECT i FROM n)`).run();
    const require = createRequire(import.meta.url);
    const killed = spawnSync(process.execPath, ['-e', `
      const Database = require(${JSON.stringify(require.resolve('better-sqlite3'))});
      const db = new Database(${JSON.stringify(file)});
      db.pragma('cache_size = 10');
      db.exec('BEGIN');
      db.exec('UPDATE hot_case SET v = 2');
      process.kill(process.pid, 'SIGKILL');
    `]);
    expect(killed.signal).toBe('SIGKILL');
    expect(fs.statSync(`${file}-journal`).size).toBeGreaterThan(0);
    // The swap's rename fails (its new file is not there): the previous import must be served as it was
    expect(() => served.swapInLeagueDatabase(path.join(tempDir('pennant-hot-'), 'missing.db'))).toThrow();
    const check = new Database(file, { readonly: true });
    try {
      expect(check.prepare('SELECT DISTINCT v FROM hot_case').all()).toEqual([{ v: 1 }]);
      expect(check.pragma('integrity_check', { simple: true })).toBe('ok');
    } finally {
      check.close();
      served.db.exec('DROP TABLE hot_case');
    }
  });
});
