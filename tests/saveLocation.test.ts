import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { loadConfig, saveConfig, type AppConfig } from '../server/config.js';
import { csvExportedAt, currentSaveLocation, forgetSaveLocation, saveLocationStats } from '../server/dataStatus.js';

/*
 * The save's place is kept (N9's queued fix, SWIFTUI_REBUILD.md section 9): finding it stats the folders the
 * configuration names, which inside another app's container cost every request tens of milliseconds. It is kept against
 * the configuration and the served import, found again when either changes, and looked for again after 15 seconds while
 * it has not been found; the live log's files are looked at every time.
 */

let original: AppConfig;
let root = '';

const saveFolder = (name: string): string => {
  const lg = path.join(root, `${name}.lg`);
  fs.mkdirSync(path.join(lg, 'import_export', 'csv'), { recursive: true });
  fs.mkdirSync(path.join(lg, 'temp'), { recursive: true });
  fs.writeFileSync(path.join(lg, 'import_export', 'csv', 'players.csv'), 'player_id\n1\n');
  return lg;
};

beforeAll(() => {
  original = loadConfig();
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'pennant-save-location-'));
});

afterEach(() => vi.restoreAllMocks());

afterAll(() => {
  saveConfig(original);
  forgetSaveLocation();
  fs.rmSync(root, { recursive: true, force: true });
});

describe('the save\'s place is kept per configuration and import (N9)', () => {
  it('looks for the save once, and still sees the live log\'s files come and go', () => {
    const lg = saveFolder('Kept');
    saveConfig({ csvDir: path.join(lg, 'import_export', 'csv'), saveName: 'Kept' });
    forgetSaveLocation();
    const before = saveLocationStats().locates;
    const first = currentSaveLocation();
    expect(first.found).toBe(true);
    expect(first.lgPath).toBe(lg);
    expect(first.live?.dbExists).toBe(false);
    fs.writeFileSync(path.join(lg, 'temp', 'text_data.sqlite3'), '');
    const second = currentSaveLocation();
    expect(second.lgPath).toBe(lg);
    expect(second.live?.dbExists).toBe(true);
    expect(saveLocationStats().locates - before).toBe(1);
  });

  it('finds the save again when the configuration names another', () => {
    const other = saveFolder('Other');
    const before = saveLocationStats().locates;
    // A different size and time: the configuration's stamp moves
    saveConfig({ csvDir: path.join(other, 'import_export', 'csv'), saveName: 'Other save, chosen again' });
    expect(currentSaveLocation().lgPath).toBe(other);
    expect(saveLocationStats().locates - before).toBe(1);
  });

  it('looks again for a save it has not found, but no more than every 15 seconds', () => {
    saveConfig({ csvDir: path.join(root, 'not-a-save', 'csv'), saveName: null });
    forgetSaveLocation();
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now);
    const before = saveLocationStats().locates;
    expect(currentSaveLocation().found).toBe(false);
    currentSaveLocation();
    expect(saveLocationStats().locates - before).toBe(1);
    vi.spyOn(Date, 'now').mockReturnValue(now + 15_001);
    currentSaveLocation();
    expect(saveLocationStats().locates - before).toBe(2);
  });

  it('keeps when the export was written for 15 seconds, then reads it again', () => {
    const lg = saveFolder('Written');
    const csv = path.join(lg, 'import_export', 'csv');
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now);
    const first = csvExportedAt(csv);
    expect(first).not.toBeNull();
    const later = new Date(Date.parse(first!) + 60_000);
    fs.utimesSync(path.join(csv, 'players.csv'), later, later);
    expect(csvExportedAt(csv)).toBe(first);
    vi.spyOn(Date, 'now').mockReturnValue(now + 15_001);
    expect(csvExportedAt(csv)).toBe(later.toISOString());
  });
});
