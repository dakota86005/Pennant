import fs from 'node:fs';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { importState } from '../server/api.js';
import { loadConfig, saveConfig, type AppConfig } from '../server/config.js';
import { clubForgottenWhenImported, forgetClubWhenImported, loadSettings } from '../server/settings.js';
import { stopWatcher } from '../server/watcher.js';
import { APP_STORE_27, PretendHome } from './saveHomeFixture';
import request, { post } from './request';
import { clubOwed } from '../server/clubOwed.js';

/**
 * The first run's zero-question setup (D-063, BEHAVIOR_CASES "Finding the save"): with no save chosen, the save that
 * clearly stands out is chosen and imported without asking, and its club followed when the save's human manages exactly
 * one; otherwise nothing is chosen and the answer says why. A save already chosen is never replaced.
 */
const realHome = process.env.HOME;
let home: PretendHome;
let before: AppConfig;

beforeAll(() => { before = loadConfig(); });
afterAll(() => {
  saveConfig(before);
  process.env.HOME = realHome;
  stopWatcher();
});
beforeEach(() => {
  home = new PretendHome();
  process.env.HOME = home.dir;
  saveConfig({ csvDir: null, saveName: null });
});
afterEach(async () => {
  await until(() => !importState.importing);
  home.cleanup();
});

async function until(ok: () => boolean, ms = 20_000): Promise<void> {
  const start = Date.now();
  while (!ok()) {
    if (Date.now() - start > ms) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 20));
  }
}

describe('a first run with no save chosen', () => {
  it('chooses and imports the save that clearly stands out, and follows the one club its human manages; asking again starts nothing', async () => {
    const current = home.save(APP_STORE_27, 'D-backs real save', { playedHoursAgo: 2 });
    home.save(APP_STORE_27, 'Old league', { playedHoursAgo: 24 * 10 });
    await post('/api/settings', { defaultOrgId: 3 });
    const first = await post('/api/v2/setup/automatic', {});
    expect(first).toMatchObject({
      outcome: 'started',
      text: 'Using D-backs real save, the save you\'ve played most recently.',
      save: { name: 'D-backs real save', csvDir: current.csvDir },
      club: { decided: true, teamId: 1, name: 'Arizona Diamondbacks', humanClubs: 1 },
    });
    expect(first.why.basis.certainty).toBe('policy');
    expect(loadConfig()).toMatchObject({ csvDir: current.csvDir, saveName: 'D-backs real save' });
    await until(() => !importState.importing && importState.lastImport?.csvDir === current.csvDir);
    // Automatic once the import lands: the club the save's human manages, never the club chosen before
    expect(loadSettings().defaultOrgId).toBeNull();
    const imported = importState.lastImport!.startedAt;

    const again = await post('/api/v2/setup/automatic', {});
    expect(again).toMatchObject({ outcome: 'alreadyChosen', save: { csvDir: current.csvDir }, club: null, why: null });
    expect(importState.importing).toBe(false);
    await new Promise((r) => setTimeout(r, 50));
    expect(importState.lastImport!.startedAt).toBe(imported);
  });

  it('takes no club when the save\'s human manages several, and says Pennant will ask', async () => {
    home.save(APP_STORE_27, 'Two clubs', { playedHoursAgo: 1, humanClubs: [[1, 'Arizona', 'Diamondbacks'], [3, 'Boston', 'Red Sox']] });
    await post('/api/settings', { defaultOrgId: 3 });
    const answer = await post('/api/v2/setup/automatic', {});
    expect(answer).toMatchObject({ outcome: 'started', club: { decided: false, teamId: null, humanClubs: 2 } });
    expect(answer.club.text).toBe('You manage 2 clubs in this save, so Pennant will ask which to follow.');
    // The club chosen before belongs to another league: forgotten once this save's import lands, and the GM is asked
    await until(() => !importState.importing);
    expect(importState.lastError).toBeNull();
    expect(loadSettings().defaultOrgId).toBeNull();
  });

  it('chooses nothing when no save clearly stands out, and says why', async () => {
    home.save(APP_STORE_27, 'One', { playedHoursAgo: 1 });
    home.save(APP_STORE_27, 'Two', { playedHoursAgo: 5 });
    const answer = await post('/api/v2/setup/automatic', {});
    expect(answer).toMatchObject({ outcome: 'nothingStandsOut', save: null, club: null });
    expect(answer.why.text).toBe('You\'ve played One and Two within 2 days of each other');
    expect(loadConfig().csvDir).toBeNull();
    expect(importState.importing).toBe(false);
  });

  it('never replaces a save already chosen', async () => {
    const chosen = home.save(APP_STORE_27, 'Chosen', { playedHoursAgo: 24 * 30 });
    home.save(APP_STORE_27, 'Newer', { playedHoursAgo: 1 });
    saveConfig({ csvDir: chosen.csvDir, saveName: 'Chosen' });
    const answer = await post('/api/v2/setup/automatic', {});
    expect(answer).toMatchObject({ outcome: 'alreadyChosen', text: 'Chosen is already chosen.', save: { name: 'Chosen' } });
    expect(loadConfig().csvDir).toBe(chosen.csvDir);
  });
});

describe('a save chosen by the GM, with its club taken from the save (N6 Stage B2)', () => {
  /** Chooses a save with its club taken from it, and waits for its import to finish. */
  async function choose(csvDir: string, saveName: string): Promise<{ club: Record<string, unknown> }> {
    const answer = await post('/api/config', { csvDir, saveName, club: 'fromSave' });
    await until(() => !importState.importing);
    return answer;
  }

  it('follows the one club the chosen save\'s human manages, as the first run does, once its import lands', async () => {
    const other = home.save(APP_STORE_27, 'Played since', { playedHoursAgo: 1 });
    await post('/api/settings', { defaultOrgId: 3 });
    const answer = await post('/api/config', { csvDir: other.csvDir, saveName: 'Played since', club: 'fromSave' });
    expect(answer).toMatchObject({
      ok: true, importStarted: true, why: null,
      club: { decided: true, teamId: 1, name: 'Arizona Diamondbacks', humanClubs: 1 },
    });
    expect(loadConfig()).toMatchObject({ csvDir: other.csvDir, saveName: 'Played since' });
    await until(() => !importState.importing);
    expect(importState.lastError).toBeNull();
    expect(loadSettings().defaultOrgId).toBeNull();
  });

  it('keeps the club the GM chose when the same save is chosen again (Choose Another Save…, or a switch back)', async () => {
    const two = home.save(APP_STORE_27, 'Two clubs', { playedHoursAgo: 1, humanClubs: [[1, 'Arizona', 'Diamondbacks'], [3, 'Boston', 'Red Sox']] });
    expect((await choose(two.csvDir, 'Two clubs')).club).toMatchObject({ decided: false, humanClubs: 2 });
    // The GM answers the club question
    await post('/api/settings', { defaultOrgId: 3 });
    const again = await choose(two.csvDir, 'Two clubs');
    expect(again.club).toEqual({ decided: true, teamId: 3, name: 'Boston Red Sox', humanClubs: 2, text: 'Keeping the Boston Red Sox, the club you chose.' });
    expect(importState.lastError).toBeNull();
    expect(loadSettings().defaultOrgId).toBe(3);
    await post('/api/settings', { defaultOrgId: null });
  });

  it('owes the club question from the import of a save with several clubs until the GM chooses, through the routes (L4)', async () => {
    const two = home.save(APP_STORE_27, 'Owed', { playedHoursAgo: 1, humanClubs: [[1, 'Arizona', 'Diamondbacks'], [3, 'Boston', 'Red Sox']] });
    await post('/api/settings', { defaultOrgId: null });
    const answer = await post('/api/config', { csvDir: two.csvDir, saveName: 'Owed', club: 'fromSave' });
    expect(answer.club).toMatchObject({ decided: false, humanClubs: 2 });
    await until(() => !importState.importing && importState.lastImport?.csvDir === two.csvDir);
    expect(importState.lastError).toBeNull();
    expect((await request('/api/status')).clubOwed).toMatchObject({ humanClubs: 2, text: 'You manage 2 clubs in this save. Choose the one to follow.' });
    expect((await request('/api/settings')).clubOwed).toMatchObject({ humanClubs: 2 });
    // The GM answers: nothing is owed any more, across a relaunch too
    await post('/api/settings', { defaultOrgId: 3 });
    expect((await request('/api/status')).clubOwed).toBeNull();
    expect(clubOwed()).toBeNull();
    await post('/api/settings', { defaultOrgId: null });
  });

  it('never keeps a club from another league: a switch between two saves with several clubs forgets it, and asks', async () => {
    const clubs: Array<[number, string, string]> = [[1, 'Arizona', 'Diamondbacks'], [3, 'Boston', 'Red Sox']];
    const first = home.save(APP_STORE_27, 'League one', { playedHoursAgo: 1, humanClubs: clubs });
    const second = home.save(APP_STORE_27, 'League two', { playedHoursAgo: 2, humanClubs: clubs });
    await choose(first.csvDir, 'League one');
    await post('/api/settings', { defaultOrgId: 3 });
    const switched = await post('/api/config', { csvDir: second.csvDir, saveName: 'League two', club: 'fromSave' });
    expect(switched.club).toMatchObject({ decided: false, teamId: null, humanClubs: 2 });
    await until(() => !importState.importing);
    expect(importState.lastError).toBeNull();
    // Team 3 of League one is not team 3 of League two: forgotten, and the GM is asked
    expect(loadSettings().defaultOrgId).toBeNull();
  });

  it('leaves the club untouched when the new save\'s import fails', async () => {
    const held = home.save(APP_STORE_27, 'Held', { playedHoursAgo: 1, humanClubs: [[1, 'Arizona', 'Diamondbacks'], [3, 'Boston', 'Red Sox']] });
    const broken = home.save(APP_STORE_27, 'Broken', { playedHoursAgo: 2 });
    // Its players file is days older than the rest of its export: the import refuses it
    const old = new Date(Date.now() - 3 * 24 * 3_600_000);
    fs.utimesSync(path.join(broken.csvDir, 'players.csv'), old, old);
    await choose(held.csvDir, 'Held');
    await post('/api/settings', { defaultOrgId: 3 });
    const answer = await choose(broken.csvDir, 'Broken');
    expect(answer.club).toMatchObject({ decided: true, teamId: 1 });
    expect(importState.lastError).not.toBeNull();
    expect(loadSettings().defaultOrgId).toBe(3);
    // Choosing the save Pennant still holds keeps it too
    expect((await choose(held.csvDir, 'Held')).club).toMatchObject({ decided: true, teamId: 3, text: 'Keeping the Boston Red Sox, the club you chose.' });
    expect(loadSettings().defaultOrgId).toBe(3);
    await post('/api/settings', { defaultOrgId: null });
  });

  it('never forgets a club the GM chose while the import was still running', async () => {
    forgetClubWhenImported('/somewhere/import_export/csv');
    await post('/api/settings', { defaultOrgId: 3 });
    expect(clubForgottenWhenImported('/somewhere/import_export/csv')).toBe(false);
    await post('/api/settings', { defaultOrgId: null });
  });

  it('leaves the club alone when not asked (the React app and the folder typed by hand)', async () => {
    const save = home.save(APP_STORE_27, 'By hand', { playedHoursAgo: 1 });
    await post('/api/settings', { defaultOrgId: 3 });
    const answer = await post('/api/config', { csvDir: save.csvDir, saveName: 'By hand' });
    expect(answer).toMatchObject({ ok: true, importStarted: true, club: null });
    expect(loadSettings().defaultOrgId).toBe(3);
    await post('/api/settings', { defaultOrgId: null });
  });
});
