import { afterEach, describe, expect, it } from 'vitest';
import path from 'node:path';
import { detectSaves, searchLocations, type SaveInfo } from '../server/paths.js';
import { pickSave, STANDOUT_WINDOW_MS } from '../server/saveDiscovery.js';
import { OOTP_EXPORT_DOCS, saveDiscoveryView } from '../server/presentation/saveWords.js';
import { bannedInPayload } from './bannedJargon';
import { APP_STORE_27, DIRECT_28, HOME_APP_SUPPORT_27, PretendHome } from './saveHomeFixture';

/**
 * Finding the save (D-063, BEHAVIOR_CASES "Finding the save"): when a save was last played is the time OOTP last saved
 * it, never its export's time; saves are found under every OOTP version; the save being played is picked only when it
 * clearly stands out, and otherwise the saves are listed most recently played first and the GM is asked.
 */
const homes: PretendHome[] = [];
const home = (): PretendHome => {
  const h = new PretendHome();
  homes.push(h);
  return h;
};
afterEach(() => { for (const h of homes.splice(0)) h.cleanup(); });

const HOUR = 3_600_000;

/** A save as `pickSave` sees it: only its last-played time and whether it has an export matter. */
const save = (name: string, playedHoursAgo: number | null, hasExport = true, now = Date.parse('2040-07-01T12:00:00Z')): SaveInfo => ({
  name, lgPath: `/saves/${name}.lg`, csvDir: `/saves/${name}.lg/import_export/csv`, csvCount: hasExport ? 70 : 0,
  csvLastModified: null, csvLastModifiedText: null, id: name,
  lastPlayedAt: playedHoursAgo === null ? null : new Date(now - playedHoursAgo * HOUR).toISOString(), hasExport,
});

describe('when a save was last played', () => {
  it('is when OOTP last saved it (the newer of the files it writes on a save), never when its export was written', () => {
    const h = home();
    // Played an hour ago with an export from three days ago; a copy exported an hour ago but last played two days ago
    h.save(APP_STORE_27, 'Current', { playedHoursAgo: 1, exportedHoursAgo: 72 });
    h.save(APP_STORE_27, 'Copy', { playedHoursAgo: 48, exportedHoursAgo: 1 });
    const saves = detectSaves(h.dir);
    expect(saves.map((s) => s.name)).toEqual(['Current', 'Copy']);
    expect(Date.now() - Date.parse(saves[0].lastPlayedAt!)).toBeLessThan(2 * HOUR);
    expect(saves[0].exportedAt).toBe(saves[0].csvLastModified);
  });

  it('is not known for a folder OOTP never saved, which is listed last and is never the save being played', () => {
    const h = home();
    h.save(APP_STORE_27, 'Played', { playedHoursAgo: 100 });
    h.save(APP_STORE_27, 'Never saved', { playedHoursAgo: null, exportedHoursAgo: 1 });
    h.stray(APP_STORE_27, ''); // a folder named just ".lg" is not a save
    const saves = detectSaves(h.dir);
    expect(saves.map((s) => [s.name, s.lastPlayedAt === null])).toEqual([['Played', false], ['Never saved', true]]);
    expect(pickSave(saves).pick?.name).toBe('Played');
  });

  it('finds saves under every OOTP version and place: the App Store container, the direct build, a second Application Support', () => {
    const h = home();
    h.save(APP_STORE_27, 'Store 27', { playedHoursAgo: 10 });
    h.save(DIRECT_28, 'Direct 28', { playedHoursAgo: 5 });
    h.save(HOME_APP_SUPPORT_27, 'Home 27', { playedHoursAgo: 200, exportedHoursAgo: null });
    const saves = detectSaves(h.dir);
    expect(saves.map((s) => [s.name, s.ootpVersion, s.location])).toEqual([
      ['Direct 28', 28, 'OOTP 28, direct download'],
      ['Store 27', 27, 'OOTP 27, Mac App Store version'],
      ['Home 27', 27, 'OOTP 27, Application Support in your home folder'],
    ]);
    const home27 = saves[2];
    expect(home27).toMatchObject({ hasExport: false, exportConfigured: false, simulatedThrough: '2030-05-15' });
    expect(home27.exportNote).toMatch(/Game Settings, then the Database tab, and use Database Tools/);
    expect(saves[0]).toMatchObject({ hasExport: true, exportConfigured: true, exportNote: null });
    // Each save has a stable id, the same on every look
    expect(detectSaves(h.dir).map((s) => s.id)).toEqual(saves.map((s) => s.id));
  });

  it('says where it looked: each folder found, and a pattern where none was', () => {
    const h = home();
    h.save(DIRECT_28, 'Direct 28');
    const where = searchLocations(h.dir, 'darwin');
    expect(where).toContainEqual({ label: 'OOTP 28, direct download', path: path.join(h.dir, DIRECT_28), exists: true });
    expect(where.find((w) => w.label === 'OOTP, Mac App Store version')).toMatchObject({ exists: false });
    expect(where.find((w) => w.label === 'OOTP, Mac App Store version')!.path).toContain('com.ootpdevelopments.ootp*macqlm');
  });
});

describe('the save being played is picked only when it clearly stands out', () => {
  it('picks the save played most recently when it has an export and no other save was played in the two days before it', () => {
    const pick = pickSave([save('Older', 60), save('Current', 2)]);
    expect(pick).toMatchObject({ reason: null, pick: { name: 'Current' }, runnerUp: { name: 'Older' } });
  });

  it('asks when another save was played within two days before it (a hair either side of the line)', () => {
    const inside = pickSave([save('Current', 0), save('Other', STANDOUT_WINDOW_MS / HOUR - 0.01)]);
    expect(inside).toMatchObject({ pick: null, reason: 'tooClose' });
    const outside = pickSave([save('Current', 0), save('Other', STANDOUT_WINDOW_MS / HOUR + 0.01)]);
    expect(outside.pick?.name).toBe('Current');
    // A save with no export played in the window counts too: it is a save being played
    expect(pickSave([save('Current', 0), save('New game', 3, false)]).reason).toBe('tooClose');
  });

  it('asks when the save played most recently has no export, whatever the others\' exports say', () => {
    expect(pickSave([save('Playing', 1, false), save('Exported long ago', 500)])).toMatchObject({ pick: null, reason: 'noExport', latest: { name: 'Playing' } });
  });

  it('asks when no save has a last-played time, and when there are no saves', () => {
    expect(pickSave([save('Never', null)]).reason).toBe('neverPlayed');
    expect(pickSave([]).reason).toBe('noSaves');
  });

  it('never picks by export time: a copy with the same export as the save being played does not stand out beside it', () => {
    const h = home();
    // The owner's case: a save and a copy of it made a day before its last play share one export's files and times
    h.save(APP_STORE_27, 'D-backs real save', { playedHoursAgo: 3, exportedHoursAgo: 80 });
    h.save(APP_STORE_27, 'RIGHTS-MASTER', { playedHoursAgo: 27, exportedHoursAgo: 80 });
    expect(pickSave(detectSaves(h.dir))).toMatchObject({ pick: null, reason: 'tooClose' });
  });
});

describe('the discovery payload', () => {
  it('states the pick\'s reason and basis, stamped as a policy line, in plain words', () => {
    const saves = [save('Current', 2), save('Older', 60)];
    const view = saveDiscoveryView(saves, pickSave(saves), []);
    expect(view.pick?.saveId).toBe('Current');
    const c = view.pick!.claim;
    expect(c.text).toMatch(/^Last played \w{3} \d+, the most recent of your saves, and it has an export$/);
    expect(c.basis.certainty).toBe('policy');
    expect(c.basis.stamp).toMatch(/no other save played in the two days before it/);
    expect(c.basis.because.map((l) => l.label)).toEqual(['Last played', 'Export', 'Next most recent', 'Found in']);
    expect(c.basis.because[2].value).toMatch(/^Older, last played .* \(2 days earlier\)$/);
    expect(view.noPick).toBeNull();
    expect(bannedInPayload(view, 'getSaveDiscovery')).toEqual([]);
  });

  it('says why nothing was picked, and how to turn the export on with OOTP\'s documentation cited when the latest save has none', () => {
    const saves = [save('Playing', 1, false), save('Other', 100)];
    const view = saveDiscoveryView(saves, pickSave(saves), []);
    expect(view.pick).toBeNull();
    expect(view.noPick).toMatchObject({ reason: 'noExport', claim: { text: 'Playing, your most recent save, has no export yet' } });
    const help = view.exportHelp!;
    expect(help.basis.certainty).toBe('fact');
    const cited = help.basis.because.map((l) => l.value).join(' ');
    expect(cited).toContain(OOTP_EXPORT_DOCS.wiki);
    expect(cited).toContain(OOTP_EXPORT_DOCS.manual);
    expect(help.basis.unknown.join(' ')).toMatch(/doesn't name the menus/);
    expect(bannedInPayload(view, 'getSaveDiscovery')).toEqual([]);
    const close = [save('A', 1), save('B', 5)];
    expect(saveDiscoveryView(close, pickSave(close), []).noPick?.claim.text).toBe('You\'ve played A and B within 2 days of each other');
  });
});
