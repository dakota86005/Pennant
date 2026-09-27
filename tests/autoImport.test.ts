import { afterAll, afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DATA_DIR, loadConfig, saveConfig } from '../server/config.js';
import { assessFiles, BURST_WINDOW_MS, exportTiming, type ExportFile } from '../server/exportFiles.js';
import { checkExport, clearPendingExport, onSettledExport, pendingExport, watchClock, type SettledExportHandler } from '../server/watcher.js';
import { handleSettledExport, importState, isNewExport, runImport, statusSnapshot } from '../server/api.js';
import type { ImportResult } from '../server/importer.js';
import request from './request';

/**
 * Knowing when OOTP has finished an export, and importing it without being asked (D-061): quiet for the quiet period,
 * every file from one burst, a fingerprint to tell a new export from the one imported; automatic by default, offered
 * when automatic import is off; `/api/status` answering throughout.
 */
const scratch: string[] = [];
const savedConfig = loadConfig();
const settingsPath = path.join(DATA_DIR, 'settings.json');
afterAll(() => {
  for (const d of scratch) fs.rmSync(d, { recursive: true, force: true });
  saveConfig(savedConfig);
  fs.rmSync(settingsPath, { force: true });
});

function exportDir(version: number, rows = 50): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pennant-auto-'));
  scratch.push(dir);
  fs.writeFileSync(path.join(dir, 'leagues.csv'), `league_id,version\n1,${version}\n`);
  fs.writeFileSync(path.join(dir, 'teams.csv'), `team_id,version\n1,${version}\n`);
  const body = Array.from({ length: rows }, (_, i) => `${i},${version}`).join('\n');
  fs.writeFileSync(path.join(dir, 'players.csv'), `player_id,version\n${body}\n`);
  return dir;
}

const file = (name: string, mtimeMs: number, size = 10): ExportFile => ({ file: `${name}.csv`, table: name, size, mtimeMs });

describe('an export is finished when it has been quiet, and whole when its files are from one burst', () => {
  afterEach(() => { exportTiming.quietMs = 0; });

  it('is not settled while a file was written within the quiet period, and is once the period has passed', () => {
    exportTiming.quietMs = 10_000;
    const t = 1_000_000_000;
    const files = [file('leagues', t), file('players', t + 30_000), file('teams', t + 38_000)];
    expect(assessFiles(files, t + 38_000 + 9_999).settled).toBe(false);
    expect(assessFiles(files, t + 38_000 + 10_000).settled).toBe(true);
  });

  it('calls a file written long before the rest stale, and the rest current', () => {
    const t = 2_000_000_000;
    const a = assessFiles([file('leagues', t), file('teams', t + 40_000), file('players_game_batting', t - BURST_WINDOW_MS - 1)], t + 60_000);
    expect(a.stale.map((f) => f.table)).toEqual(['players_game_batting']);
    expect(a.current.map((f) => f.table).sort()).toEqual(['leagues', 'teams']);
    // The fingerprint is the current files': the stale one does not make every import look new
    expect(a.fingerprint).toBe(assessFiles([file('leagues', t), file('teams', t + 40_000)], t + 60_000).fingerprint);
  });

  it('waits for the quiet period on a fake clock, and starts again when OOTP writes another file', () => {
    exportTiming.quietMs = 10_000;
    const dir = exportDir(1);
    const t = Math.floor(Date.now() / 1000) * 1000;
    for (const f of fs.readdirSync(dir)) fs.utimesSync(path.join(dir, f), new Date(t), new Date(t));
    let now = t + 3_000;
    const timers: Array<{ at: number; fn: () => void }> = [];
    const saved = { ...watchClock };
    Object.assign(watchClock, {
      now: () => now,
      setTimeout: (fn: () => void, ms: number) => { timers.push({ at: now + ms, fn }); return timers.length as unknown as ReturnType<typeof setTimeout>; },
      clearTimeout: () => { timers.length = 0; },
    });
    const settled: Array<Parameters<SettledExportHandler>[1]> = [];
    onSettledExport((_dir, assessment) => settled.push(assessment));
    try {
      checkExport(dir);
      expect(settled).toHaveLength(0);
      expect(timers).toHaveLength(1);
      expect(timers[0].at).toBe(t + 10_050);
      // OOTP writes one more file at t + 8 s: the look at t + 10 s finds it still settling
      fs.utimesSync(path.join(dir, 'teams.csv'), new Date(t + 8_000), new Date(t + 8_000));
      now = t + 10_050;
      timers.shift()!.fn();
      expect(settled).toHaveLength(0);
      expect(timers[0].at).toBe(t + 18_050);
      now = t + 18_050;
      timers.shift()!.fn();
      expect(settled).toHaveLength(1);
      expect(settled[0].settled).toBe(true);
    } finally {
      Object.assign(watchClock, saved);
      onSettledExport(handleSettledExport); // the import pipeline's own handler, as api.ts registers it
    }
  });
});

describe('a new export is told from the one imported by its fingerprint', () => {
  it('is new when the fingerprint differs, and not when it is the same', () => {
    const t = 3_000_000_000;
    const a = assessFiles([file('leagues', t)], t + 20_000);
    const last = { startedAt: new Date(t + 5_000).toISOString(), exportFingerprint: a.fingerprint } as ImportResult;
    expect(isNewExport(a, last)).toBe(false);
    expect(isNewExport(assessFiles([file('leagues', t + 1)], t + 20_000), last)).toBe(true);
    expect(isNewExport(a, null)).toBe(true);
  });

  it('for an import from before fingerprints, is new when written after that import started', () => {
    const t = 4_000_000_000;
    const legacy = { startedAt: new Date(t).toISOString() } as ImportResult;
    expect(isNewExport(assessFiles([file('leagues', t - 1_000)], t + 20_000), legacy)).toBe(false);
    expect(isNewExport(assessFiles([file('leagues', t + 1_000)], t + 20_000), legacy)).toBe(true);
  });
});

describe('a settled new export', () => {
  const until = async (probe: () => boolean, ms = 20_000): Promise<void> => {
    const deadline = Date.now() + ms;
    while (!probe()) {
      if (Date.now() > deadline) throw new Error('timed out');
      await new Promise((r) => setTimeout(r, 20));
    }
  };
  it('is offered, not imported, when automatic import is off; imported in the background when it is on (the default)', async () => {
    const dir = exportDir(1);
    saveConfig({ csvDir: dir, saveName: null });
    fs.writeFileSync(settingsPath, JSON.stringify({ importAutomatically: false }));
    clearPendingExport();
    const before = importState.lastImport;
    checkExport(dir);
    expect(pendingExport()).not.toBeNull();
    expect(importState.importing).toBe(false);
    expect(importState.lastImport).toBe(before);

    fs.rmSync(settingsPath, { force: true }); // the default: on
    checkExport(dir);
    expect(importState.importing).toBe(true);
    await until(() => !importState.importing);
    expect(importState.lastError).toBeNull();
    expect(importState.lastImport?.csvDir).toBe(dir);
    expect(pendingExport()).toBeNull();
    // The same export again is not new
    const imported = importState.lastImport;
    checkExport(dir);
    expect(importState.importing).toBe(false);
    expect(importState.lastImport).toBe(imported);
  });

  it('keeps /api/status answering quickly while it imports', async () => {
    const dir = exportDir(2, 250_000);
    const times: number[] = [];
    await request('/api/status'); // the route is warm
    const running = runImport(dir);
    let polling = true;
    const poll = (async () => {
      while (polling) {
        const started = performance.now();
        const status = await request('/api/status');
        times.push(performance.now() - started);
        expect(status).toHaveProperty('importing');
        await new Promise((r) => setTimeout(r, 10));
      }
    })();
    await running;
    polling = false;
    await poll;
    expect(importState.lastError).toBeNull();
    times.sort((a, b) => a - b);
    const p95 = times[Math.floor(times.length * 0.95)];
    expect(times.length).toBeGreaterThan(5);
    // Generous (CI hardware varies; the target on the real export is 50 ms): the old import answered in seconds
    expect(p95, `p95 ${p95.toFixed(0)} ms over ${times.length} requests`).toBeLessThan(250);
    // The Electron app's shapes: the status and last-import.json keep every field they had
    const snap = statusSnapshot();
    expect(snap.lastImport).toMatchObject({ tables: 3, rows: 250_002, startedAt: expect.any(String), finishedAt: expect.any(String), files: expect.any(Array) });
    const onDisk = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'last-import.json'), 'utf8')) as ImportResult;
    expect(Object.keys(onDisk)).toEqual(expect.arrayContaining(['tables', 'rows', 'startedAt', 'finishedAt', 'files']));
    expect(fs.existsSync(path.join(DATA_DIR, 'import-in-progress.json'))).toBe(false);
  });
});

describe('an import whose after-steps never ran (the server stopped between the swap and the snapshots)', () => {
  it('takes its snapshots at the next start, once', async () => {
    const { finishInterruptedPostImport } = await import('../server/api.js');
    const record = path.join(DATA_DIR, 'post-import.json');
    const saved = importState.lastImport;
    try {
      importState.lastImport = { tables: 1, rows: 1, startedAt: '2040-07-01T12:00:00.000Z', finishedAt: '2040-07-01T12:00:05.000Z', files: [], exportFingerprint: 'f' };
      fs.rmSync(record, { force: true });
      expect(finishInterruptedPostImport()).toBe(true);
      const deadline = Date.now() + 30_000;
      while (!fs.existsSync(record) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50));
      expect(JSON.parse(fs.readFileSync(record, 'utf8')).importStartedAt).toBe('2040-07-01T12:00:00.000Z');
      // Done: the next start leaves it
      expect(finishInterruptedPostImport()).toBe(false);
      // An import from before N3.5 (no fingerprint, no record) took its snapshots on its own thread
      fs.rmSync(record, { force: true });
      importState.lastImport = { tables: 1, rows: 1, startedAt: '2040-07-02T12:00:00.000Z', finishedAt: '2040-07-02T12:00:05.000Z', files: [] };
      expect(finishInterruptedPostImport()).toBe(false);
    } finally {
      importState.lastImport = saved;
    }
  }, 60_000);
});
