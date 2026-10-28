import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { loadConfig, saveConfig } from '../server/config.js';
import { db, forgetImportRecord, LAST_IMPORT_PATH } from '../server/db.js';
import { historyDb } from '../server/history.js';
import { saveId } from '../server/paths.js';
import { forgetServedSaveFolder } from '../server/servedSave.js';
import { clearSaveIdentityCache, differentLeague, LINEAGE_POLICY, legacySaveIdentity, saveIdentity } from '../server/saveIdentity.js';
// The stores register their tables when they load, as in the server
import '../server/playerValueFitStore.js';
import '../server/saveCalibrationStore.js';
import { makeSave, type FakeSave } from './liveLogFixture';

/**
 * The save's identity is its id, never its name or its league's data (D-079, B-59 / SRVINFRA-12): renaming the league or an
 * old player leaving the export no longer orphans a save's fitted history, and the rows filed under the identity before it
 * are carried over once, never orphaned.
 */

const LEAGUE = 100;
const before = loadConfig();
const lastImportBefore = fs.existsSync(LAST_IMPORT_PATH) ? fs.readFileSync(LAST_IMPORT_PATH) : null;
let save: FakeSave;

function imported(csvDir: string): void {
  const startedAt = new Date().toISOString();
  db.exec('CREATE TABLE IF NOT EXISTS pennant_import (key TEXT PRIMARY KEY, value TEXT)');
  db.prepare(`INSERT OR REPLACE INTO pennant_import (key, value) VALUES ('import', ?)`).run(JSON.stringify({ startedAt, csvDir }));
  fs.writeFileSync(LAST_IMPORT_PATH, JSON.stringify({ startedAt }));
  forgetImportRecord();
  forgetServedSaveFolder();
  clearSaveIdentityCache();
}

const fit = (identity: string, through: number, reason: string) => historyDb.prepare(
  `INSERT OR REPLACE INTO value_production_fits (save_name, league_id, through_season, method, game_date, fitted_at, adopted, reason, prior_weight, fit_ms, model_json, record_json)
   VALUES (?, ?, ?, 'carry-test', NULL, 'x', 1, ?, NULL, NULL, '{}', '{}')`,
).run(identity, LEAGUE, through, reason);
const fitsOf = (identity: string) => (historyDb.prepare(
  `SELECT through_season AS through, reason FROM value_production_fits WHERE save_name = ? AND method = 'carry-test' ORDER BY through_season`,
).all(identity) as Array<{ through: number; reason: string }>);

beforeEach(() => {
  save = makeSave({ name: 'Carry Save', rows: [] });
  saveConfig({ csvDir: save.csvDir, saveName: 'Carry Save' });
  historyDb.prepare(`DELETE FROM value_production_fits WHERE method = 'carry-test'`).run();
  historyDb.prepare(`DELETE FROM save_identity_carried`).run();
});
afterEach(() => {
  db.prepare(`DELETE FROM pennant_import WHERE key = 'import'`).run();
  if (lastImportBefore) fs.writeFileSync(LAST_IMPORT_PATH, lastImportBefore);
  else fs.rmSync(LAST_IMPORT_PATH, { force: true });
  saveConfig(before);
  forgetImportRecord();
  forgetServedSaveFolder();
  clearSaveIdentityCache();
  historyDb.prepare(`DELETE FROM value_production_fits WHERE method = 'carry-test'`).run();
  save.cleanup();
});
afterAll(() => clearSaveIdentityCache());

describe('the save identity (SRVINFRA-12)', () => {
  it("is the served save's folder id, and does not move when the league's data moves", () => {
    imported(save.csvDir);
    const identity = saveIdentity(LEAGUE);
    expect(identity).toBe(`save:${saveId(save.lg)}`);
    const name = (db.prepare('SELECT name FROM leagues WHERE league_id = ?').get(LEAGUE) as { name: string }).name;
    try {
      db.prepare('UPDATE leagues SET name = ? WHERE league_id = ?').run('Renamed League', LEAGUE);
      saveConfig({ csvDir: save.csvDir, saveName: 'Renamed Save' });
      clearSaveIdentityCache();
      expect(saveIdentity(LEAGUE)).toBe(identity);
    } finally {
      db.prepare('UPDATE leagues SET name = ? WHERE league_id = ?').run(name, LEAGUE);
    }
  });

  it('carries the rows filed under the name and fingerprint over once, keeping any its id already has', () => {
    imported(save.csvDir);
    const legacy = legacySaveIdentity(LEAGUE, 'Carry Save');
    const id = `save:${saveId(save.lg)}`;
    fit(legacy, 2038, 'old 2038');
    fit(legacy, 2039, 'old 2039');
    fit(id, 2039, 'own 2039');
    expect(saveIdentity(LEAGUE)).toBe(id);
    expect(fitsOf(id)).toEqual([{ through: 2038, reason: 'old 2038' }, { through: 2039, reason: 'own 2039' }]);
    // A row the id already had is never written over: the old one stays where it was, unused
    expect(fitsOf(legacy)).toEqual([{ through: 2039, reason: 'old 2039' }]);
    // Once: a row filed under the old identity later is not moved again
    fit(legacy, 2040, 'late');
    clearSaveIdentityCache();
    saveIdentity(LEAGUE);
    expect(fitsOf(legacy).map((r) => r.through)).toEqual([2039, 2040]);
  });

  it('carries nothing while a chosen save\'s import has not landed (the configured name is not the served save\'s)', () => {
    imported(save.csvDir);
    const other = makeSave({ name: 'Chosen Save', rows: [] });
    try {
      fit(legacySaveIdentity(LEAGUE, 'Chosen Save'), 2038, 'chosen');
      saveConfig({ csvDir: other.csvDir, saveName: 'Chosen Save' });
      clearSaveIdentityCache();
      expect(saveIdentity(LEAGUE)).toBe(`save:${saveId(save.lg)}`);
      expect(fitsOf(`save:${saveId(save.lg)}`)).toEqual([]);
      expect(historyDb.prepare(`SELECT COUNT(*) AS n FROM save_identity_carried`).get()).toEqual({ n: 0 });
    } finally {
      other.cleanup();
    }
  });
});

describe('another league made in the same save folder (D-01, F1, kept under the save id)', () => {
  const players = (from: number, n: number) => Array.from({ length: n }, (_, i) => `${from + i}@1990-01-01`);

  it('is told apart only on clear evidence: a few players changed, or too few to tell, keeps the identity', () => {
    expect(differentLeague(players(1, 64), players(2, 64))).toBe(false);
    expect(differentLeague(players(1, 64), players(1000, 64))).toBe(true);
    expect(differentLeague(players(1, LINEAGE_POLICY.minPlayers - 1), players(1000, 64))).toBe(false);
    expect(differentLeague([], players(1, 64))).toBe(false);
  });
});
