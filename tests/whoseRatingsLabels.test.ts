import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildClubhouseViews } from '../server/clubhouseViewsBuild.js';
import { resetClubhouseViews } from '../server/clubhouseViewService.js';
import { resetFrontOfficeCache } from '../server/frontOfficeService.js';
import { clearFieldingPopulationCache } from '../server/scoutedEvidence.js';
import { whoseGrades } from '../server/ratingMode.js';
import { tipScouted } from '../server/presentation/player/words.js';
import { assessFreshness } from '../server/dataFreshness.js';
import type { DataStatus } from '../server/dataStatus.js';
import { dataStatusView } from '../server/presentation/dataStatusWords.js';
import { buildPlayerDossiers } from '../server/playerDossierBuild.js';
import { developmentHistoryFor, historyDb, stampSnapshotMode } from '../server/history.js';
import { currentHistoryKey } from '../server/historyIdentity.js';
import { buildSave, type BuiltSave } from './syntheticSave';
import { setExportRatingMode } from './ratingModeFixture';

/*
 * Whose ratings are shown, said truly (B-34; deep hunt SRVDEV-08, round-one FO-25, FARM-29). Grades were labelled "Your scouts'"
 * whatever the export carried, so in a "Show real player ratings" export true ratings were passed off as the club's scouting, and
 * OSA's view likewise; the Data Status row said "Not known" with no way forward.
 */

/** Every visible string in a payload (`display`, `text`, `hint`). */
function visible(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(visible);
  if (!value || typeof value !== 'object') return [];
  return Object.entries(value as Record<string, unknown>).flatMap(([k, x]) => (typeof x === 'string' && ['display', 'text', 'hint'].includes(k) ? [x] : visible(x)));
}

let save: BuiltSave;

beforeAll(() => {
  save = buildSave({ season: 2040, historySeasons: 1, gamesPerTeam: 60, playedShare: 0.5, clubs: 4, seed: 11, teamSeason: true, minors: true, lineups: true });
}, 120_000);

afterAll(() => {
  setExportRatingMode(null);
  resetClubhouseViews();
});

const clubhouse = (mode: 'real' | 'scouted' | 'osa') => {
  setExportRatingMode(mode);
  clearFieldingPopulationCache();
  resetFrontOfficeCache();
  resetClubhouseViews();
  const built = buildClubhouseViews({ orgId: save.org, importStamp: null, reportStamp: `whose-${mode}` });
  return visible([built.rosters, built.pitching, built.depth, built.lineups]);
};

describe('the clubhouse names whose grades it shows', () => {
  it('in a "real ratings" export, no grade is called the scouts\'', () => {
    const shown = clubhouse('real');
    expect(shown.filter((t) => /your scouts'/i.test(t))).toEqual([]);
    expect(shown.some((t) => /^The true .*grade/.test(t))).toBe(true);
  });

  it('in an OSA export, OSA\'s', () => {
    const shown = clubhouse('osa');
    expect(shown.filter((t) => /your scouts'/i.test(t))).toEqual([]);
    expect(shown.some((t) => /^OSA's .*grade/.test(t))).toBe(true);
  });

  it('in a scouts\'-view export, still the scouts\' (control)', () => {
    expect(clubhouse('scouted').some((t) => /^Your scouts' .*grade/.test(t))).toBe(true);
  });
});

describe('the words name whoever graded him', () => {
  it('the Scouted tip and the agent follow the kind, and an unknown kind is the export\'s, never the scouts\'', () => {
    expect(tipScouted(whoseGrades('real'))).toMatch(/^The true grades/);
    expect(tipScouted(whoseGrades('real'))).not.toMatch(/organization's own view/);
    expect(tipScouted(whoseGrades('scouted-complete'))).toMatch(/^Your scouts' grades.*organization's own view/);
    expect(whoseGrades('unknown')).toMatchObject({ possessive: 'The export\'s', agent: null });
    expect(whoseGrades(null).possessive).toBe('The export\'s');
  });
});

describe('the Data Status ratings row says what makes the kind known', () => {
  const freshness = assessFreshness({ saveSimulatedThrough: '2040-05-08', csvCurrentDate: '2040-05-09', log: { available: true, lastTransactionDate: '2040-05-08', coveredThrough: '2040-05-08' } });
  const status = (imported: DataStatus['import']): DataStatus => ({
    generatedAt: '2040-07-01T12:00:00.000Z', configured: true,
    save: { found: true, name: 'Test', lgPath: '/saves/Test.lg', discovery: 'csv_layout', discoveryNotes: [], simulatedThrough: '2040-05-08', dateSource: null },
    csv: { currentDate: '2040-05-09', simulatedThrough: freshness.csv.through, exportedAt: '2040-07-01T11:00:00.000Z', importedAt: '2040-07-01T11:05:00.000Z' },
    transactionLog: { readable: true, path: null, lastTransactionDate: '2040-05-08', coveredThrough: '2040-05-08' } as unknown as DataStatus['transactionLog'],
    freshness,
    ...(imported ? { import: imported } : {}),
  } as DataStatus);
  const hint = (s: DataStatus) => dataStatusView(s).sources.find((r) => r.id === 'ratings')!.cells.state.hint;

  it('an import from before the kind was noted: the next import notes it', () => {
    expect(hint(status({ ratingMode: null, leftOut: [] }))).toMatch(/next import will note it/);
  });

  it('settings changed after the export: export again', () => {
    expect(hint(status({ ratingMode: { mode: 'unknown', additionalScouted: null, source: 'settings_changed_after_export', reason: 'changed' }, leftOut: [] }))).toMatch(/export again/);
  });

  it('two kinds switched on: choose one', () => {
    expect(hint(status({ ratingMode: { mode: 'unknown', additionalScouted: null, source: 'export_settings', reason: 'OOTP\'s export settings have more than one kind of ratings switched on.' }, leftOut: [] }))).toMatch(/Choose one kind/);
  });
});

describe('the Ratings tab and Development tracking agree on what is kept', () => {
  it('an export of unknown kind: the Ratings tab is headed with whose ratings they are, never "Not known" (FARM-29)', () => {
    setExportRatingMode('unknown');
    const id = save.regular;
    const built = buildPlayerDossiers({ orgId: save.org, importStamp: null, reportStamp: 'whose-dossier', playerIds: [id] });
    const ratings = (built.views[0] as unknown as { ratings: { source: { text: string } } }).ratings;
    expect(ratings.source.text).toBe('The export\'s ratings');
    setExportRatingMode(null);
  });

  it('a snapshot kept but of an unknown kind is counted as set aside, with the reason in words (FARM-18)', () => {
    const date = '2040-5-6';
    historyDb.prepare(
      `INSERT OR REPLACE INTO save_rating_snapshots (save_key, game_date, player_id, name, team_id, org_id, level, position, age, cur, pot)
       VALUES (?, ?, 941001, 'Aside', ?, ?, 2, 6, 21, 50, 60)`
    ).run(currentHistoryKey(), date, save.org, save.org);
    stampSnapshotMode(date, { mode: 'unknown', additionalScouted: null, source: 'export_settings', reason: 'two kinds on' }, null);
    try {
      const history = developmentHistoryFor(save.org);
      expect(history.dates).not.toContain(date);
      expect(history.setAside.count).toBeGreaterThanOrEqual(1);
      expect(history.setAside.reasons.join(' ')).toMatch(/May 6, 2040 couldn't be read/);
    } finally {
      historyDb.prepare('DELETE FROM save_rating_snapshots WHERE save_key = ? AND player_id = 941001').run(currentHistoryKey());
      historyDb.prepare('DELETE FROM save_rating_snapshot_modes WHERE save_key = ? AND game_date = ?').run(currentHistoryKey(), date);
    }
  });
});
