import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { api } from '../server/api.js';
import { clearClubOwed, clubForgottenOnImport, importLandedForClubQuestion, oweClubWhenImported, clubOwed } from '../server/clubOwed.js';
import { DATA_DIR, loadConfig, saveConfig } from '../server/config.js';
import { currentSaveLocation, forgetSaveLocation, getDataStatus, resetTransactionLogCache } from '../server/dataStatus.js';
import { db, forgetImportRecord, LAST_IMPORT_PATH } from '../server/db.js';
import { locateSave, MANUAL_SET_ASIDE } from '../server/ootpSave.js';
import { playerPicture } from '../server/playerContext.js';
import { forgetServedSaveFolder, servedSaveKey, switchPending } from '../server/servedSave.js';
import { chosenOrgId, loadSettings } from '../server/settings.js';
import { currentOrganization, humanClubs } from '../server/viewingOrganization.js';
import { stopWatcher, watchedFolder } from '../server/watcher.js';
import { makeSave, tx, type FakeSave } from './liveLogFixture';

/**
 * The served save is the only save (BEHAVIOR_CASES.md "Pennant for Mac", D-079; B-57): choosing another save never
 * shows the league held under the new save's name, nor reads the new save's live log, date or folder against it; the
 * app waits for the chosen save's import; and the club chosen in one save is never followed in another, across a
 * relaunch too.
 */

const SETTINGS = path.join(DATA_DIR, 'settings.json');
const before = loadConfig();
const settingsBefore = fs.existsSync(SETTINGS) ? fs.readFileSync(SETTINGS) : null;
const lastImportBefore = fs.existsSync(LAST_IMPORT_PATH) ? fs.readFileSync(LAST_IMPORT_PATH) : null;
const saves: FakeSave[] = [];

/** The served league's import, as this build records it: the export folder it read. */
function imported(csvDir: string): void {
  const startedAt = new Date(Date.now() + saves.length).toISOString();
  db.exec('CREATE TABLE IF NOT EXISTS pennant_import (key TEXT PRIMARY KEY, value TEXT)');
  db.prepare(`INSERT OR REPLACE INTO pennant_import (key, value) VALUES ('import', ?)`).run(JSON.stringify({ startedAt, csvDir }));
  fs.writeFileSync(LAST_IMPORT_PATH, JSON.stringify({ startedAt }));
  forgetImportRecord();
  forgetServedSaveFolder();
  forgetSaveLocation();
  resetTransactionLogCache();
}

function save(name: string, simulated: [number, number, number] = [2030, 5, 31]): FakeSave {
  const made = makeSave({ name, simulated, rows: [] });
  saves.push(made);
  return made;
}

function choose(made: FakeSave, saveName: string): void {
  saveConfig({ csvDir: made.csvDir, saveName });
  forgetSaveLocation();
  resetTransactionLogCache();
}

const firstPlayer = (): number => (db.prepare('SELECT player_id AS id FROM players ORDER BY player_id LIMIT 1').get() as { id: number }).id;

async function served(): Promise<{ base: string; close: () => void }> {
  const app = express();
  app.use(express.json());
  app.use('/api', api);
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  return { base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, close: () => server.close() };
}

afterEach(() => {
  db.prepare(`DELETE FROM pennant_import WHERE key = 'import'`).run();
  if (lastImportBefore) fs.writeFileSync(LAST_IMPORT_PATH, lastImportBefore);
  else fs.rmSync(LAST_IMPORT_PATH, { force: true });
  saveConfig(before);
  if (settingsBefore) fs.writeFileSync(SETTINGS, settingsBefore);
  else fs.rmSync(SETTINGS, { force: true });
  forgetImportRecord();
  forgetServedSaveFolder();
  forgetSaveLocation();
  resetTransactionLogCache();
  clearClubOwed();
  stopWatcher();
});
afterAll(() => {
  for (const s of saves) s.cleanup();
});

describe('a save chosen and not yet imported (SRVINFRA-01)', () => {
  it("never gives the served league's players the chosen save's transactions, date or name", () => {
    const a = save('Served Save', [2030, 5, 31]);
    const b = save('Another Save', [2030, 6, 10]);
    const id = firstPlayer();
    b.add([{ date: '20300520', text: tx.optioned([id, 'Someone Else'], 'SS', [99, 'Reno']) }]);
    choose(a, 'Served Save');
    imported(a.csvDir);
    // The GM chooses B: what chooseSave writes first
    choose(b, 'Another Save');
    expect(switchPending()).toEqual({ csvDir: b.csvDir, saveName: 'Another Save' });
    const picture = playerPicture(id)!;
    expect(picture.chronology.map((e) => e.playerName)).not.toContain('Someone Else');
    expect(currentSaveLocation().lgPath).toBe(a.lg);
    const status = getDataStatus();
    expect(status.save).toMatchObject({ name: 'Served Save', lgPath: a.lg, simulatedThrough: '2030-05-31' });
    // B's import lands: everything moves together
    imported(b.csvDir);
    expect(switchPending()).toBeNull();
    expect(playerPicture(id)!.chronology.map((e) => [e.kind, e.playerName])).toEqual([['optioned', 'Someone Else']]);
    expect(getDataStatus().save).toMatchObject({ name: 'Another Save', lgPath: b.lg, simulatedThrough: '2030-06-10' });
  });

  it("waits for the chosen save's import: the league held is not served, and the status says why", async () => {
    const a = save('Served Save');
    const b = save('No Export Yet');
    choose(a, 'Served Save');
    imported(a.csvDir);
    fs.rmSync(b.csvDir, { recursive: true, force: true });
    choose(b, 'No Export Yet');
    const { base, close } = await served();
    try {
      const status = await (await fetch(`${base}/api/status`)).json();
      expect(status.saveId).toBeNull();
      expect(status.saveFolder).toBeNull();
      expect(status.awaitingImport).toMatchObject({ saveName: 'No Export Yet' });
      expect(status.awaitingImport.text).toMatch(/^No Export Yet has no export yet/);
      for (const route of ['/api/v2/catalog', '/api/orgs', `/api/v2/player/${firstPlayer()}`, '/api/data-status', '/api/watchlist']) {
        const answer = await fetch(`${base}${route}`);
        expect(answer.status, route).toBe(409);
        expect((await answer.json()).error, route).toBe(status.awaitingImport.text);
      }
      // A write for the save being left is refused too
      const note = await fetch(`${base}/api/player-notes`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ player_id: firstPlayer(), body: 'x' }),
      });
      expect(note.status).toBe(409);
      // Choosing a save and the app's own settings still answer, and no club of the league held is served
      expect((await fetch(`${base}/api/v2/saves`)).status).toBe(200);
      const settings = await (await fetch(`${base}/api/settings`)).json();
      expect(settings.organization).toBeNull();
      // The import lands: nothing waits
      imported(b.csvDir);
      expect((await (await fetch(`${base}/api/status`)).json()).awaitingImport).toBeNull();
      expect((await fetch(`${base}/api/orgs`)).status).toBe(200);
    } finally {
      close();
    }
  });

  it('watches the chosen save for an export only when watching is on, even before it has one (SRVINFRA-25)', async () => {
    const a = save('Served Save');
    const b = save('Watched');
    choose(a, 'Served Save');
    imported(a.csvDir);
    fs.rmSync(b.csvDir, { recursive: true, force: true });
    fs.writeFileSync(SETTINGS, JSON.stringify({ ...loadSettings(), autoImport: false }));
    const { base, close } = await served();
    try {
      const post = (body: unknown) => fetch(`${base}/api/config`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      expect((await (await post({ csvDir: b.csvDir, saveName: 'Watched' })).json()).importStarted).toBe(false);
      expect(watchedFolder()).toBeNull();
      fs.writeFileSync(SETTINGS, JSON.stringify({ ...loadSettings(), autoImport: true }));
      await post({ csvDir: b.csvDir, saveName: 'Watched' });
      expect(watchedFolder()).toBe(b.csvDir);
    } finally {
      close();
    }
  });
});

describe('a save folder named by hand (SRVINFRA-19)', () => {
  it("is set aside beside an export that sits in another save's folder, and the folder in use is served", () => {
    const a = save('Export Save');
    const c = save('Hand Named');
    const location = locateSave({ csvDir: a.csvDir, manualLgPath: c.lg });
    expect(location).toMatchObject({ lgPath: a.lg, method: 'csv_layout' });
    expect(location.notes).toContain(MANUAL_SET_ASIDE);
  });

  it('wins over a save found only by its name, and a name two saves share finds neither', () => {
    const elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), 'pennant-loose-export-'));
    const c = save('Hand Named');
    try {
      expect(locateSave({ csvDir: elsewhere, saveName: 'Anything', manualLgPath: c.lg })).toMatchObject({ lgPath: c.lg, method: 'manual_override' });
    } finally {
      fs.rmSync(elsewhere, { recursive: true, force: true });
    }
  });

  it("is refused when the export sits in another save's folder, in a sentence", async () => {
    const a = save('Export Save');
    const c = save('Hand Named');
    choose(a, 'Export Save');
    imported(a.csvDir);
    const { base, close } = await served();
    try {
      const answer = await fetch(`${base}/api/save-source`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ lgPath: c.lg }) });
      expect(answer.status).toBe(400);
      expect((await answer.json()).error).toMatch(/^The export is inside Export Save\.lg/);
      expect(loadConfig().lgPath ?? null).not.toBe(c.lg);
      // Its own folder is accepted
      const own = await fetch(`${base}/api/save-source`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ lgPath: a.lg }) });
      expect(own.status).toBe(200);
    } finally {
      close();
    }
  });
});

describe("the club chosen in one save (SRVINFRA-04)", () => {
  beforeEach(() => clearClubOwed());

  it('is never followed in another save, after a relaunch too', async () => {
    const a = save('Club Save');
    const b = save('Other League');
    choose(a, 'Club Save');
    imported(a.csvDir);
    const { base, close } = await served();
    try {
      const club = humanClubs()[0] ?? 1;
      const other = club + 1;
      await fetch(`${base}/api/settings`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ defaultOrgId: other }) });
      expect(loadSettings()).toMatchObject({ defaultOrgId: other, defaultOrgSave: servedSaveKey() });
      expect(currentOrganization()).toMatchObject({ id: other, source: 'configured' });
      // Another save is served (its import landed after a relaunch: nothing held in memory): its own club is followed
      choose(b, 'Other League');
      imported(b.csvDir);
      expect(chosenOrgId()).toBeNull();
      expect(currentOrganization()?.source).not.toBe('configured');
      expect((await (await fetch(`${base}/api/settings`)).json()).settings.defaultOrgId).toBeNull();
      // Back to the save it was chosen in: followed again
      choose(a, 'Club Save');
      imported(a.csvDir);
      expect(currentOrganization()).toMatchObject({ id: other, source: 'configured' });
    } finally {
      close();
    }
  });

  it("keeps what the chosen save's import owes the club on disk, so a relaunch before it lands keeps it", async () => {
    oweClubWhenImported({ csvDir: '/saves/Two.lg/import_export/csv', humanClubs: 2 });
    expect(JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'club-pending.json'), 'utf8'))).toMatchObject({ owe: { csvDir: '/saves/Two.lg/import_export/csv', humanClubs: 2 } });
    const { forgetClubWhenImported } = await import('../server/settings.js');
    forgetClubWhenImported('/saves/Two.lg/import_export/csv');
    expect(clubForgottenOnImport()).toBe('/saves/Two.lg/import_export/csv');
    // A new process reads it from the file, as a relaunch does
    vi.resetModules();
    const fresh = await import('../server/clubOwed.js');
    expect(fresh.importLandedForClubQuestion('/saves/Two.lg/import_export/csv')).toBe(true);
    expect(clubOwed()).toMatchObject({ humanClubs: 2 });
    expect(importLandedForClubQuestion('/saves/Two.lg/import_export/csv')).toBe(true);
  });
});
