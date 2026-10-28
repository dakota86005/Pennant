import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { briefingPath } from '../server/aiSurfacesService.js';
import { DATA_DIR, loadConfig, saveConfig } from '../server/config.js';
import { db, forgetImportRecord, LAST_IMPORT_PATH } from '../server/db.js';
import { addStaffNote, historyDb, staffNotesOf } from '../server/history.js';
import { saveId } from '../server/paths.js';
import { MIGRATION_RECORD, migrateToSaveKeys } from '../server/saveKeyMigration.js';
import { forgetServedSaveFolder, servedSaveKey } from '../server/servedSave.js';
import { chosenOrgId, loadSettings, nextSeasonBudgetFor, philosophyForOrg } from '../server/settings.js';
import { chosenPack } from '../server/themePackStore.js';
import { makeSave, type FakeSave } from './liveLogFixture';

/**
 * The GM's inputs belong to the save, not to its name or a team id (D-079, B-59: SRVINFRA-08, SRVINFRA-09, SRVSTATS-10),
 * and the one-time migration gives what was kept the old way to the save configured when it runs: tried on a data folder
 * written in the old format (this test's own scratch data folder, never a real one).
 */

const SETTINGS = path.join(DATA_DIR, 'settings.json');
const BACKUPS = path.join(DATA_DIR, 'backups');
const configBefore = loadConfig();
const settingsBefore = fs.existsSync(SETTINGS) ? fs.readFileSync(SETTINGS) : null;
const lastImportBefore = fs.existsSync(LAST_IMPORT_PATH) ? fs.readFileSync(LAST_IMPORT_PATH) : null;
const OLD_AI = ['briefing-3.json', 'storylines-3.json', 'chat-3.json', 'chat-3-scout.json', 'chat-context-3.json'];
let a: FakeSave;
let b: FakeSave;

/** The served league's import, as this build records it. */
function imported(csvDir: string): void {
  const startedAt = new Date().toISOString();
  db.exec('CREATE TABLE IF NOT EXISTS pennant_import (key TEXT PRIMARY KEY, value TEXT)');
  db.prepare(`INSERT OR REPLACE INTO pennant_import (key, value) VALUES ('import', ?)`).run(JSON.stringify({ startedAt, csvDir }));
  fs.writeFileSync(LAST_IMPORT_PATH, JSON.stringify({ startedAt }));
  forgetImportRecord();
  forgetServedSaveFolder();
}

function serve(save: FakeSave, name: string): void {
  saveConfig({ csvDir: save.csvDir, saveName: name });
  imported(save.csvDir);
}

/** A data folder as the builds before D-079 left it. */
function oldFormat(): void {
  const watch = historyDb.prepare(`INSERT OR REPLACE INTO watchlist (save_name, player_id, name, note, added_at, updated_at) VALUES (?, ?, ?, ?, 'x', 'x')`);
  watch.run('New Game', 1234, 'Kept Player', 'his note');
  watch.run('Another Name', 1234, 'Other Player', 'another save\'s note');
  const note = historyDb.prepare(`INSERT INTO player_notes (save_name, player_id, player_name, source, body, game_date, created_at) VALUES (?, ?, ?, 'You', ?, NULL, 'x')`);
  note.run('New Game', 1234, 'Kept Player', 'Pitch count plan');
  note.run('Another Name', 1234, 'Other Player', 'Another save\'s plan');
  fs.writeFileSync(SETTINGS, JSON.stringify({
    defaultOrgId: 3,
    organizationPhilosophies: { 3: { version: 1, mode: 'manual', manual: { riskTolerance: 80 }, overrides: [], policies: {} } },
    nextSeasonBudget: { 3: 180_000_000 },
    themePacks: { 3: 'example-pack' },
  }, null, 2));
  for (const f of OLD_AI) fs.writeFileSync(path.join(DATA_DIR, f), JSON.stringify(f.startsWith('briefing') ? { markdown: 'A kept briefing', gameDate: '2030-05-01' } : []));
}

function clean(): void {
  historyDb.prepare(`DELETE FROM watchlist WHERE player_id = 1234`).run();
  historyDb.prepare(`DELETE FROM player_notes WHERE player_id = 1234`).run();
  for (const f of OLD_AI) fs.rmSync(path.join(DATA_DIR, f), { force: true });
  fs.rmSync(path.join(DATA_DIR, 'saves'), { recursive: true, force: true });
  fs.rmSync(MIGRATION_RECORD, { force: true });
  fs.rmSync(BACKUPS, { recursive: true, force: true });
}

beforeEach(() => {
  a = makeSave({ name: 'New Game', rows: [] });
  b = makeSave({ name: 'New Game', rows: [] });
  clean();
  oldFormat();
});
afterEach(() => {
  clean();
  db.prepare(`DELETE FROM pennant_import WHERE key = 'import'`).run();
  if (lastImportBefore) fs.writeFileSync(LAST_IMPORT_PATH, lastImportBefore);
  else fs.rmSync(LAST_IMPORT_PATH, { force: true });
  saveConfig(configBefore);
  if (settingsBefore) fs.writeFileSync(SETTINGS, settingsBefore);
  else fs.rmSync(SETTINGS, { force: true });
  forgetImportRecord();
  forgetServedSaveFolder();
  a.cleanup();
  b.cleanup();
});
afterAll(() => clean());

describe('the one-time migration to the save\'s key', () => {
  it('gives what was kept by name or team id to the save configured, and leaves another save\'s where it was', () => {
    serve(a, 'New Game');
    const key = `save:${saveId(a.lg)}`;
    const done = migrateToSaveKeys();
    expect(done).toMatchObject({ ran: true, saveKey: key, watchlist: 1, notes: 1, leftForOtherSaves: 2, clubSettings: 3, clubStamped: true, aiFiles: 5 });
    expect(servedSaveKey()).toBe(key);
    expect(staffNotesOf(1234).map((n) => n.body)).toEqual(['Pitch count plan']);
    expect(philosophyForOrg(3).manual.riskTolerance).toBe(80);
    expect(nextSeasonBudgetFor(3)).toBe(180_000_000);
    expect(chosenPack(3)).toBe('example-pack');
    expect(chosenOrgId()).toBe(3);
    expect(JSON.parse(fs.readFileSync(briefingPath(3), 'utf8'))).toMatchObject({ markdown: 'A kept briefing' });
    for (const f of OLD_AI) expect(fs.existsSync(path.join(DATA_DIR, f)), f).toBe(false);
    // Another save's rows are left exactly as they were
    expect(historyDb.prepare(`SELECT COUNT(*) AS n FROM player_notes WHERE save_name = 'Another Name'`).get()).toEqual({ n: 1 });
    // What changed was copied first, and the run is recorded
    expect(fs.readdirSync(BACKUPS).some((f) => f.startsWith('gm-inputs-before-save-key-'))).toBe(true);
    expect(fs.readdirSync(BACKUPS).some((f) => f.startsWith('settings-before-save-key-'))).toBe(true);
    expect(JSON.parse(fs.readFileSync(MIGRATION_RECORD, 'utf8'))).toMatchObject({ saveKey: key, notes: 1 });
  });

  it('runs once: a second start changes nothing, and a run cut short finishes without doing anything twice', () => {
    serve(a, 'New Game');
    migrateToSaveKeys();
    const settings = fs.readFileSync(SETTINGS, 'utf8');
    expect(migrateToSaveKeys().ran).toBe(false);
    expect(fs.readFileSync(SETTINGS, 'utf8')).toBe(settings);
    // A crash before the record was written: the next start finds nothing left in the old form
    fs.rmSync(MIGRATION_RECORD);
    expect(migrateToSaveKeys()).toMatchObject({ ran: true, watchlist: 0, notes: 0, clubSettings: 0, clubStamped: false, aiFiles: 0 });
    expect(staffNotesOf(1234)).toHaveLength(1);
    expect(fs.readFileSync(SETTINGS, 'utf8')).toBe(settings);
  });

  it('waits for a save to be configured', () => {
    saveConfig({ csvDir: null, saveName: null });
    expect(migrateToSaveKeys().ran).toBe(false);
    expect(fs.existsSync(MIGRATION_RECORD)).toBe(false);
  });
});

describe('another save of the same name and the same team ids (B-59)', () => {
  it('never shows, reads or writes the first save\'s notes, watchlist, philosophy, budget, theme, club or AI writing', () => {
    serve(a, 'New Game');
    migrateToSaveKeys();
    serve(b, 'New Game');
    expect(staffNotesOf(1234)).toEqual([]);
    expect(historyDb.prepare(`SELECT COUNT(*) AS n FROM watchlist WHERE save_name = ?`).get(servedSaveKey())).toEqual({ n: 0 });
    expect(philosophyForOrg(3).manual.riskTolerance).toBe(50);
    expect(nextSeasonBudgetFor(3)).toBeNull();
    expect(chosenPack(3)).not.toBe('example-pack');
    expect(chosenOrgId()).toBeNull();
    expect(fs.existsSync(briefingPath(3))).toBe(false);
    // A note written here is this save's alone
    addStaffNote({ playerId: 1234, playerName: 'Here', source: 'You', body: 'Only in B', gameDate: null });
    serve(a, 'New Game');
    expect(staffNotesOf(1234).map((n) => n.body)).toEqual(['Pitch count plan']);
    expect(loadSettings().nextSeasonBudget[`save:${saveId(a.lg)}|3`]).toBe(180_000_000);
  });
});
