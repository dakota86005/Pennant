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
