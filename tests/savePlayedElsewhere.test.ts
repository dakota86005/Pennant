import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig, saveConfig, type AppConfig } from '../server/config.js';
import { detectSaves, saveId } from '../server/paths.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { db, forgetImportRecord, LAST_IMPORT_PATH } from '../server/db.js';
import { currentPlayedElsewhere, discoveryClock, noticeKey, refreshServedSaveId, resetSaveDiscovery, scanSaves, servedSaveId, startSaveWatch } from '../server/saveDiscovery.js';
import { subscribe, type ServerEvent } from '../server/serverEvents.js';
import { APP_STORE_27, DIRECT_28, HOME_APP_SUPPORT_27, PretendHome } from './saveHomeFixture';
import request from './request';

/**
 * "Played since" (D-063, BEHAVIOR_CASES "Finding the save"): when another save, or a newer OOTP's, has been played since
 * the chosen one, the status says so with that save, once OOTP has finished saving it, and never switches by itself.
 */
let before: AppConfig;
const homes: PretendHome[] = [];
const original = { ...discoveryClock };

beforeAll(() => { before = loadConfig(); });
afterAll(() => {
  saveConfig(before);
});
afterEach(() => {
  Object.assign(discoveryClock, original);
  resetSaveDiscovery();
  for (const h of homes.splice(0)) h.cleanup();
});

function world(): { home: PretendHome; at: (msFromNow: number) => void } {
  const home = new PretendHome();
  homes.push(home);
  const base = Date.now();
  let offset = 0;
  discoveryClock.saves = () => detectSaves(home.dir);
  discoveryClock.now = () => base + offset;
  return { home, at: (ms) => { offset = ms; } };
}

describe('a save played since the chosen one', () => {
  it('is said once OOTP has finished saving it (its times still for a minute), with the save to switch to, and never switched to', async () => {
    const { home, at } = world();
    const chosen = home.save(APP_STORE_27, 'Chosen', { playedHoursAgo: 10 });
    const other = home.save(APP_STORE_27, 'RIGHTS-EXP', { playedHoursAgo: 20 / 3600 }); // saved 20 s ago
    saveConfig({ csvDir: chosen.csvDir, saveName: 'Chosen' });

    // OOTP may still be writing it: nothing yet, and nothing flickers
    expect(scanSaves()).toBeNull();
    at(45_000); // 65 s after its last save
    const notice = scanSaves()!;
    expect(notice).toMatchObject({
      kind: 'otherSave',
      actionText: 'Switch to RIGHTS-EXP',
      hint: 'Pennant stays on this save until you switch.',
      save: { name: 'RIGHTS-EXP', csvDir: other.csvDir },
    });
    expect(notice.text).toMatch(/^You've played "RIGHTS-EXP" since this save, last on .+\.$/);
    expect(notice.save.id).toBeTruthy();
    // A second look finds the same, and the choice is untouched
    expect(scanSaves()).toEqual(notice);
    expect(loadConfig().csvDir).toBe(chosen.csvDir);
    // Served on the status, from the last look (no scan on the request's path)
    const status = await request('/api/status');
    expect(status.savePlayedElsewhere).toMatchObject({ kind: 'otherSave', save: { name: 'RIGHTS-EXP' } });
    expect(currentPlayedElsewhere()).toEqual(notice);
  });

  it('names a newer OOTP version when the save played since is in one', () => {
    const { home, at } = world();
    const chosen = home.save(APP_STORE_27, 'Chosen', { playedHoursAgo: 30 });
    home.save(DIRECT_28, 'First in 28', { playedHoursAgo: 2, exportedHoursAgo: null });
    saveConfig({ csvDir: chosen.csvDir, saveName: 'Chosen' });
    at(0);
    const notice = scanSaves()!;
    expect(notice.kind).toBe('newerOotp');
    expect(notice.text).toMatch(/^You've played "First in 28" in OOTP 28 since this save, last on .+\. It has no export yet\.$/);
  });

  it('says nothing when the chosen save is the one played last, when none is chosen, and when the chosen save\'s time is not known', () => {
    const { home } = world();
    const chosen = home.save(APP_STORE_27, 'Chosen', { playedHoursAgo: 1 });
    home.save(APP_STORE_27, 'Older', { playedHoursAgo: 5 });
    saveConfig({ csvDir: chosen.csvDir, saveName: 'Chosen' });
    expect(scanSaves()).toBeNull();
    saveConfig({ csvDir: null, saveName: null });
    expect(scanSaves()).toBeNull();
    const unknown = home.save(APP_STORE_27, 'Never saved', { playedHoursAgo: null, exportedHoursAgo: 1 });
    saveConfig({ csvDir: unknown.csvDir, saveName: 'Never saved' });
    expect(scanSaves()).toBeNull();
  });

  it('is announced on the event stream when the look first sees it, not on every look, and once more when it clears (N6 B1)', async () => {
    const { home, at } = world();
    const chosen = home.save(APP_STORE_27, 'Chosen', { playedHoursAgo: 10 });
    const other = home.save(APP_STORE_27, 'RIGHTS-EXP', { playedHoursAgo: 20 / 3600 });
    saveConfig({ csvDir: chosen.csvDir, saveName: 'Chosen' });
    const heard: ServerEvent[] = [];
    const unsubscribe = subscribe((event) => { if (event.type === 'save-played-elsewhere') heard.push(event); });
    try {
      // Nothing to say yet (OOTP may still be saving it): nothing announced
      expect(scanSaves()).toBeNull();
      expect(heard).toEqual([]);
      at(45_000);
      const notice = scanSaves()!;
      expect(heard).toHaveLength(1);
      expect(heard[0]).toEqual({ type: 'save-played-elsewhere', savePlayedElsewhere: notice });
      // The same notice on the next looks: announced once
      at(90_000);
      scanSaves();
      at(150_000);
      scanSaves();
      expect(heard).toHaveLength(1);
      // Played again: the sentence says when, so the new time is announced (N6 B1 review)
      home.save(APP_STORE_27, 'RIGHTS-EXP', { playedHoursAgo: 0, now: Date.now() + 150_000 });
      at(215_000);
      const again = scanSaves()!;
      expect(noticeKey(again)).not.toBe(noticeKey(notice));
      expect(heard).toHaveLength(2);
      expect(heard[1]).toEqual({ type: 'save-played-elsewhere', savePlayedElsewhere: again });
      at(275_000);
      scanSaves();
      expect(heard).toHaveLength(2);
      // The GM switched to it: the notice clears, and the clearing is announced (null, as the status serves it)
      saveConfig({ csvDir: other.csvDir, saveName: 'RIGHTS-EXP' });
      expect(scanSaves()).toBeNull();
      expect(heard).toHaveLength(3);
      expect(heard[2]).toEqual({ type: 'save-played-elsewhere', savePlayedElsewhere: null });
    } finally {
      unsubscribe();
    }
  });

  it('serves the id of the save the imported data came from, worked out off the status\'s path (N6 B1 review M3, M4)', async () => {
    const { home } = world();
    const chosen = home.save(APP_STORE_27, 'Chosen', { playedHoursAgo: 10 });
    const other = home.save(APP_STORE_27, 'RIGHTS-EXP', { playedHoursAgo: 1 });
    const late = fs.mkdtempSync(path.join(os.tmpdir(), 'pennant-late-'));
    const lateLg = path.join(late, 'Late.lg');
    const lateCsv = path.join(lateLg, 'exports', 'late');
    fs.mkdirSync(lateCsv, { recursive: true });
    const lastImport = fs.existsSync(LAST_IMPORT_PATH) ? fs.readFileSync(LAST_IMPORT_PATH) : null;
    const imported = (csvDir: string) => {
      const startedAt = new Date().toISOString();
      db.exec('CREATE TABLE IF NOT EXISTS pennant_import (key TEXT PRIMARY KEY, value TEXT)');
      db.prepare(`INSERT OR REPLACE INTO pennant_import (key, value) VALUES ('import', ?)`).run(JSON.stringify({ startedAt, csvDir }));
      fs.writeFileSync(LAST_IMPORT_PATH, JSON.stringify({ startedAt }));
      forgetImportRecord();
    };
    try {
      saveConfig({ csvDir: chosen.csvDir, saveName: 'Chosen' });
      imported(chosen.csvDir);
      // Not worked out yet: the status says nothing rather than working it out on its path
      expect((await request('/api/status')).saveId).toBeNull();
      refreshServedSaveId();
      expect((await request('/api/status')).saveId).toBe(saveId(chosen.lg));
      // Another save chosen, not yet imported: the data is still the chosen one's, and so is the id (never the new one's)
      saveConfig({ csvDir: other.csvDir, saveName: 'RIGHTS-EXP' });
      expect(servedSaveId()).toBeNull();
      refreshServedSaveId();
      expect((await request('/api/status')).saveId).toBe(saveId(chosen.lg));
      // Its import lands: the id moves with it
      imported(other.csvDir);
      refreshServedSaveId();
      expect((await request('/api/status')).saveId).toBe(saveId(other.lg));
      // A save whose folder can't be found is worked out again at the next look, never kept for good
      saveConfig({ csvDir: lateCsv, saveName: 'Late' });
      imported(lateCsv);
      refreshServedSaveId();
      expect(servedSaveId()).toBe(saveId(lateCsv));
      fs.mkdirSync(path.join(lateLg, 'settings'));
      scanSaves();
      expect(servedSaveId()).toBe(saveId(lateLg));
    } finally {
      db.prepare(`DELETE FROM pennant_import WHERE key = 'import'`).run();
      if (lastImport) fs.writeFileSync(LAST_IMPORT_PATH, lastImport);
      else fs.rmSync(LAST_IMPORT_PATH, { force: true });
      forgetImportRecord();
      fs.rmSync(late, { recursive: true, force: true });
    }
  });

  it('looks again by itself once a save played since would have settled', () => {
    const { home, at } = world();
    const chosen = home.save(APP_STORE_27, 'Chosen', { playedHoursAgo: 10 });
    home.save(APP_STORE_27, 'Other', { playedHoursAgo: 30 / 3600 });
    saveConfig({ csvDir: chosen.csvDir, saveName: 'Chosen' });
    const timers: Array<{ fn: () => void; ms: number }> = [];
    discoveryClock.setTimeout = (fn, ms) => { timers.push({ fn, ms }); return 0 as unknown as ReturnType<typeof setTimeout>; };
    discoveryClock.clearTimeout = () => {};
    startSaveWatch();
    expect(currentPlayedElsewhere()).toBeNull();
    // The next look is due about when the other save has been still for a minute, not a full minute later
    const next = timers.at(-1)!;
    expect(next.ms).toBeGreaterThan(25_000);
    expect(next.ms).toBeLessThan(35_000);
    at(next.ms);
    next.fn();
    expect(currentPlayedElsewhere()?.save.name).toBe('Other');
  });
});

describe('the minute\'s look at the saves (N3.5 B2 review, finding 2)', () => {
  it('reads no file and stats no CSV: only the times OOTP writes on a save, so a cloud-only folder never blocks it', async () => {
    const { vi } = await import('vitest');
    const fs = (await import('node:fs')).default;
    const home = new PretendHome();
    homes.push(home);
    const chosen = home.save(APP_STORE_27, 'Chosen', { playedHoursAgo: 10 });
    home.save(APP_STORE_27, 'Other', { playedHoursAgo: 1 });
    saveConfig({ csvDir: chosen.csvDir, saveName: 'Chosen' });
    const realHome = process.env.HOME;
    process.env.HOME = home.dir;
    const reads = vi.spyOn(fs, 'readFileSync');
    const stats = vi.spyOn(fs, 'statSync');
    try {
      const notice = scanSaves();
      expect(notice?.save.name).toBe('Other');
      const inSaves = (p: unknown) => String(p).startsWith(home.dir);
      expect(reads.mock.calls.filter(([p]) => inSaves(p)).map(([p]) => String(p))).toEqual([]);
      expect(stats.mock.calls.filter(([p]) => inSaves(p) && String(p).endsWith('.csv'))).toEqual([]);
      expect(notice?.save).toMatchObject({ simulatedThrough: null, exportedAt: null, hasExport: true });
    } finally {
      reads.mockRestore();
      stats.mockRestore();
      process.env.HOME = realHome;
    }
  });
});

describe('"played since" when the chosen save has gone, or a time is in the future (N3.5 B2 review)', () => {
  it('names the save played most recently when the chosen save is no longer where it was', () => {
    const { home, at } = world();
    home.save(APP_STORE_27, 'Renamed in OOTP', { playedHoursAgo: 3 });
    home.save(APP_STORE_27, 'Older', { playedHoursAgo: 50 });
    saveConfig({ csvDir: `${home.dir}/${APP_STORE_27}/Gone.lg/import_export/csv`, saveName: 'Gone' });
    at(0);
    const notice = scanSaves()!;
    expect(notice).toMatchObject({ kind: 'chosenMissing', actionText: 'Switch to Renamed in OOTP', save: { name: 'Renamed in OOTP' }, chosenLastPlayedAt: null });
    expect(notice.text).toMatch(/^Pennant can't find the save it was using\. You've played "Renamed in OOTP" most recently, last on .+\.$/);
  });

  it('never calls a save with a time in the future "played since"', () => {
    const { home } = world();
    const chosen = home.save(APP_STORE_27, 'Chosen', { playedHoursAgo: 10 });
    home.save(APP_STORE_27, 'Clock ahead', { playedHoursAgo: -2 });
    saveConfig({ csvDir: chosen.csvDir, saveName: 'Chosen' });
    expect(scanSaves()).toBeNull();
  });

  it('says where the save is when another has the same name', () => {
    const { home } = world();
    const chosen = home.save(APP_STORE_27, 'New Game', { playedHoursAgo: 10 });
    home.save(HOME_APP_SUPPORT_27, 'New Game', { playedHoursAgo: 1 });
    saveConfig({ csvDir: chosen.csvDir, saveName: 'New Game' });
    const notice = scanSaves()!;
    expect(notice.actionText).toBe('Switch to New Game (OOTP 27, Application Support in your home folder)');
  });
});
