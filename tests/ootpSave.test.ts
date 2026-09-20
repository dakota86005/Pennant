import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { locateSave, parseLastDateSimulated, readLastDateSimulated } from '../server/ootpSave.js';
import { makeSave, simulatedDateBytes, type FakeSave } from './liveLogFixture';

const made: FakeSave[] = [];
const dirs: string[] = [];
const save = (opts?: Parameters<typeof makeSave>[0]) => {
  const s = makeSave(opts);
  made.push(s);
  return s;
};
afterEach(() => {
  for (const s of made.splice(0)) s.cleanup();
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

describe('automatic save discovery', () => {
  it('derives the .lg save from the CSV export path, with no configuration', () => {
    const s = save({ name: 'My League' });
    const found = locateSave({ csvDir: s.csvDir });
    expect(found.found).toBe(true);
    expect(found.method).toBe('csv_layout');
    expect(found.lgPath).toBe(s.lg);
    expect(found.saveName).toBe('My League');
    expect(found.live?.db).toBe(path.join(s.lg, 'temp', 'text_data.sqlite3'));
    expect(found.live?.dbExists).toBe(true);
    expect(found.lastDateSimulatedPath).toBe(path.join(s.lg, 'settings', 'last_date_simulated.dat'));
  });

  it('works for any folder name and location: nothing is hard-coded to one machine', () => {
    // A save name with spaces and punctuation, somewhere no default scan looks
    const s = save({ name: "D-backs real save (copy) #2" });
    expect(locateSave({ csvDir: s.csvDir }).lgPath).toBe(s.lg);
    expect(locateSave({ csvDir: `${s.csvDir}${path.sep}` }).lgPath).toBe(s.lg);
  });

  it('reports which live files exist without requiring the WAL or SHM', () => {
    const noWal = save({ rows: [] });
    const live = locateSave({ csvDir: noWal.csvDir }).live!;
    expect(live.dbExists).toBe(true);
    expect(live.walExists).toBe(false);
    expect(live.shmExists).toBe(false);

    const running = save({ rows: [], keepWriterOpen: true });
    running.add([{ date: '20300531', text: 'x' }]);
    const runningLive = locateSave({ csvDir: running.csvDir }).live!;
    expect(runningLive.walExists).toBe(true);
    expect(runningLive.shmExists).toBe(true);
  });

  it('finds the save when the export was moved somewhere below it', () => {
    const s = save();
    const nested = path.join(s.lg, 'archive', '2030-06', 'export');
    fs.mkdirSync(nested, { recursive: true });
    const found = locateSave({ csvDir: nested });
    expect(found.method).toBe('ancestor_lg');
    expect(found.lgPath).toBe(s.lg);
  });

  it('reports a save with no live database instead of failing', () => {
    const s = save({ withLog: false });
    const found = locateSave({ csvDir: s.csvDir });
    expect(found.found).toBe(true);
    expect(found.live?.dbExists).toBe(false);
  });

  it('falls back gracefully when no .lg can be found, and says what it tried', () => {
    const elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), 'pennant-no-save-'));
    dirs.push(elsewhere);
    const csv = path.join(elsewhere, 'exports', 'csv');
    fs.mkdirSync(csv, { recursive: true });
    const found = locateSave({ csvDir: csv });
    expect(found.found).toBe(false);
    expect(found.method).toBe('not_found');
    expect(found.lgPath).toBeNull();
    expect(found.live).toBeNull();
    expect(found.notes.join(' ')).toMatch(/not inside <save>\.lg/i);
  });

  it('handles no export being configured at all', () => {
    const found = locateSave({ csvDir: null });
    expect(found.found).toBe(false);
    expect(found.notes).toContain('No CSV export is configured.');
  });

  it('uses a hand-picked folder only when the export path gives nothing', () => {
    const elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), 'pennant-no-save-'));
    dirs.push(elsewhere);
    const s = save({ name: 'Picked By Hand' });
    const manual = locateSave({ csvDir: path.join(elsewhere, 'csv'), manualLgPath: s.lg });
    expect(manual.method).toBe('manual_override');
    expect(manual.lgPath).toBe(s.lg);

    // With an export inside a real save, the manual folder is not even consulted
    const other = save({ name: 'Other' });
    expect(locateSave({ csvDir: other.csvDir, manualLgPath: s.lg }).lgPath).toBe(other.lg);
  });

  it('rejects a manual folder that is not a save', () => {
    const notASave = fs.mkdtempSync(path.join(os.tmpdir(), 'pennant-not-save-'));
    dirs.push(notASave);
    const found = locateSave({ csvDir: null, manualLgPath: notASave });
    expect(found.found).toBe(false);
  });
});

describe('last_date_simulated.dat', () => {
  it('decodes the bytes from a real save (0f 05 ea 07 00 00 00 is 15 May 2026)', () => {
    expect(parseLastDateSimulated(Buffer.from([0x0f, 0x05, 0xea, 0x07, 0, 0, 0]))).toEqual({
      date: '2026-05-15',
      source: 'last_date_simulated.dat',
    });
  });

  it('round-trips the layout for other dates', () => {
    expect(parseLastDateSimulated(simulatedDateBytes(2030, 12, 31))?.date).toBe('2030-12-31');
    expect(parseLastDateSimulated(simulatedDateBytes(1998, 3, 1))?.date).toBe('1998-03-01');
  });

  it('reads unknown instead of guessing when the bytes are not a plausible date', () => {
    expect(parseLastDateSimulated(Buffer.from([]))).toBeNull();
    expect(parseLastDateSimulated(Buffer.from([1, 2, 3]))).toBeNull();
    expect(parseLastDateSimulated(simulatedDateBytes(2030, 13, 1))).toBeNull(); // month 13
    expect(parseLastDateSimulated(simulatedDateBytes(2030, 2, 30))).toBeNull(); // 30 February
    expect(parseLastDateSimulated(simulatedDateBytes(2030, 5, 0))).toBeNull();
    expect(parseLastDateSimulated(simulatedDateBytes(9999, 5, 5))).toBeNull();
  });

  it('is unavailable, not an error, when the file is missing', () => {
    const s = save({ simulated: null });
    expect(readLastDateSimulated(locateSave({ csvDir: s.csvDir }))).toBeNull();
  });

  it('reads the date of a discovered save', () => {
    const s = save({ simulated: [2030, 5, 31] });
    expect(readLastDateSimulated(locateSave({ csvDir: s.csvDir }))?.date).toBe('2030-05-31');
  });
});
