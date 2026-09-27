import { afterAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EXPORT_SETTINGS_FILE, parseRatingMode, readRatingMode, RATING_MODE_WORDS } from '../server/ratingMode.js';
import { exportRatingMode, loadScoutedAbilities, loadScoutedHitterProfiles, ratingSource, ratingsWithheld } from '../server/scoutedEvidence.js';
import { IDS } from './fixture';
import { setExportRatingMode } from './ratingModeFixture';

/**
 * Which kind of ratings an export carries (D-061, BEHAVIOR_CASES "The import and the export's ratings"): read from OOTP's
 * export settings by each option's label, recorded with the import, and never assumed.
 */

/** OOTP's export settings as the file holds them: an id, a value, the option's label. */
const settings = (values: { osa?: string; real?: string; none?: string; additional?: string }, extra = ''): string => [
  '70 1 Export player data',
  ...(values.additional !== undefined ? [`72 ${values.additional} Additional complete scouted ratings`] : []),
  ...(values.osa !== undefined ? [`73 ${values.osa} Show OSA player ratings`] : []),
  ...(values.real !== undefined ? [`74 ${values.real} Show real player ratings`] : []),
  ...(values.none !== undefined ? [`75 ${values.none} Show no player ratings`] : []),
  extra,
].join('\r\n');

describe('the kind of ratings an export carries', () => {
  it('is the kind whose option is on, and the scouts\' view when all three are read as off', () => {
    expect(parseRatingMode(settings({ osa: '0', real: '1', none: '0', additional: '0' })).mode).toBe('real');
    expect(parseRatingMode(settings({ osa: '1', real: '0', none: '0' })).mode).toBe('osa');
    expect(parseRatingMode(settings({ osa: '0', real: '0', none: '1' })).mode).toBe('none');
    const scouted = parseRatingMode(settings({ osa: '0', real: '0', none: '0', additional: '1' }));
    expect(scouted).toEqual({ mode: 'scouted', additionalScouted: true, source: 'export_settings', reason: null });
  });

  it('is read by each option\'s label, never by its number', () => {
    // The same labels under other ids (a future OOTP renumbering) read the same; a known id under another label does not
    const renumbered = ['9 0 Show OSA player ratings', '3 1 Show real player ratings', '1 0 Show no player ratings'].join('\n');
    expect(parseRatingMode(renumbered).mode).toBe('real');
    const relabelled = ['73 0 Something else', '74 1 Another option', '75 0 A third'].join('\n');
    expect(parseRatingMode(relabelled).mode).toBe('unknown');
  });

  it('is unknown when a label is missing, a value is not 0 or 1, or two kinds are on: never assumed to be the scouts\' view', () => {
    expect(parseRatingMode(settings({ osa: '0', none: '0' })).mode).toBe('unknown');
    expect(parseRatingMode(settings({ osa: '0', real: '2', none: '0' })).mode).toBe('unknown');
    const both = parseRatingMode(settings({ osa: '1', real: '1', none: '0' }));
    expect(both.mode).toBe('unknown');
    expect(both.reason).toMatch(/more than one/);
    expect(parseRatingMode('').mode).toBe('unknown');
  });

  const dirs: string[] = [];
  afterAll(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });
  const save = (text: string | null): string => {
    const lg = fs.mkdtempSync(path.join(os.tmpdir(), 'pennant-mode-'));
    dirs.push(lg);
    if (text !== null) {
      fs.mkdirSync(path.join(lg, 'settings'), { recursive: true });
      fs.writeFileSync(path.join(lg, EXPORT_SETTINGS_FILE), text);
    }
    return lg;
  };

  it('is read from the save\'s export settings file, and a save without one, or no save, is unknown with the reason', () => {
    expect(readRatingMode(save(settings({ osa: '0', real: '1', none: '0' }))).mode).toBe('real');
    const missing = readRatingMode(save(null));
    expect(missing).toMatchObject({ mode: 'unknown', source: 'settings_missing' });
    expect(missing.reason).toMatch(/no export settings/);
    expect(readRatingMode(null)).toMatchObject({ mode: 'unknown', source: 'save_not_found' });
  });

  it('is unknown for an export written before the settings last changed: the file may describe a later setting', () => {
    const lg = save(settings({ osa: '0', real: '1', none: '0' }));
    const written = fs.statSync(path.join(lg, EXPORT_SETTINGS_FILE)).mtimeMs;
    expect(readRatingMode(lg, written + 60_000).mode).toBe('real');
    const changed = readRatingMode(lg, written - 60_000);
    expect(changed).toMatchObject({ mode: 'unknown', source: 'settings_changed_after_export' });
    expect(changed.reason).toMatch(/changed after this export was written/);
  });

  it('is served in words, and an import from before it was recorded is unknown, not the scouts\' view', () => {
    setExportRatingMode(null);
    expect(exportRatingMode().mode).toBe('unknown');
    expect(ratingSource().text).toMatch(/isn't known/);
    setExportRatingMode('real');
    expect(ratingSource()).toMatchObject({ mode: 'real', short: RATING_MODE_WORDS.real.short });
    setExportRatingMode(null);
  });

  it('"Show no player ratings" leaves every rating unknown: none is read, never a zero or a default', () => {
    setExportRatingMode('scouted');
    const seen = loadScoutedAbilities([IDS.optioned]).for(IDS.optioned);
    expect(seen.status).not.toBe('unknown');
    setExportRatingMode('none');
    try {
      expect(ratingsWithheld()).toBe(true);
      const withheld = loadScoutedAbilities([IDS.optioned]).for(IDS.optioned);
      expect(withheld.status).toBe('unknown');
      expect(withheld.current).toBeNull();
      expect(loadScoutedHitterProfiles([IDS.optioned]).size).toBe(0);
    } finally {
      setExportRatingMode(null);
    }
  });
});

describe('the rating mode an import records', () => {
  it('is read from the save the export sits in, recorded with the import and inside its database, and served on the data status', async () => {
    const { runImport, importState } = await import('../server/api.js');
    const { getDataStatus } = await import('../server/dataStatus.js');
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pennant-mode-save-'));
    const lg = path.join(root, 'Mode Test.lg');
    const csvDir = path.join(lg, 'import_export', 'csv');
    fs.mkdirSync(csvDir, { recursive: true });
    fs.mkdirSync(path.join(lg, 'settings'), { recursive: true });
    fs.writeFileSync(path.join(lg, EXPORT_SETTINGS_FILE), settings({ osa: '0', real: '1', none: '0', additional: '0' }));
    fs.writeFileSync(path.join(csvDir, 'players.csv'), 'player_id,version\n1,1\n');
    fs.writeFileSync(path.join(csvDir, 'teams.csv'), 'team_id,version\n1,1\n');
    try {
      await runImport(csvDir);
      expect(importState.lastError).toBeNull();
      expect(importState.lastImport?.ratingMode).toMatchObject({ mode: 'real', additionalScouted: false, source: 'export_settings' });
      expect(exportRatingMode().mode).toBe('real');
      expect(getDataStatus().import.ratingMode?.mode).toBe('real');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
