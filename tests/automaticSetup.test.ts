import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { importState } from '../server/api.js';
import { loadConfig, saveConfig, type AppConfig } from '../server/config.js';
import { loadSettings } from '../server/settings.js';
import { stopWatcher } from '../server/watcher.js';
import { APP_STORE_27, PretendHome } from './saveHomeFixture';
import { post } from './request';

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
    // Automatic: the club the save's human manages, never the club chosen before
    expect(loadSettings().defaultOrgId).toBeNull();
    await until(() => !importState.importing && importState.lastImport?.csvDir === current.csvDir);
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
    expect(loadSettings().defaultOrgId).toBe(3);
    await post('/api/settings', { defaultOrgId: null });
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
