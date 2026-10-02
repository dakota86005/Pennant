import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../server/db.js';
import { evaluateDestinationFit } from '../server/destinationFit.js';
import { historyDb } from '../server/history.js';
import { currentHistoryKey } from '../server/historyIdentity.js';
import { takeImportSnapshots } from '../server/importSnapshots.js';
import { computeCalibrationRefits, recordCalibrationRefits, registerCalibration } from '../server/saveCalibration.js';
import { adoptedCalibration } from '../server/saveCalibrationStore.js';
import {
  bothReadings,
  clearFieldingPopulationCache,
  inPopulationView,
  LEAGUE_POPULATION_SOURCE,
  loadScoutedAbilities,
  loadScoutedObservations,
  populationSource,
  ratingFillOf,
  withPopulationPolicy,
} from '../server/scoutedEvidence.js';
import { IDS } from './fixture';
import { setExportRatingMode } from './ratingModeFixture';

/**
 * League yardsticks and fits read OSA's view; a judgment of a player reads our scouts' (D-068, the owner's direction,
 * BEHAVIOR_CASES "League yardsticks and fits on OSA's view"). A synthetic complete-scouted file: OSA's rows
 * (`scouting_team_id` 0) and our club's.
 */

const OURS = IDS.mlbTeam;
const OSA = 0;
const PLAYER = IDS.optioned;
const OUR_GRADE = 70;
const OSA_GRADE = 40;
const RATING = /^(batting_ratings_|pitching_ratings_|fielding_rating|running_ratings_)/;

const columnsOf = (table: string): string[] =>
  (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((c) => c.name);

let ratingColumns: string[] = [];

function scoutRow(playerId: number, scoutingTeamId: number, grade: number): void {
  const position = (db.prepare('SELECT position FROM players WHERE player_id = ?').get(playerId) as { position: number }).position;
  const values: Record<string, unknown> = { player_id: playerId, position, scouting_team_id: scoutingTeamId };
  for (const c of ratingColumns) {
    const pos = /^fielding_rating_pos(\d)/.exec(c);
    values[c] = pos ? (Number(pos[1]) === position ? grade : 0) : grade;
  }
  const keys = Object.keys(values);
  db.prepare(`INSERT INTO players_scouted_ratings (${keys.join(', ')}) VALUES (${keys.map((k) => `@${k}`).join(', ')})`).run(values);
}

/** Every rated player in the fixture, rated by both: ours one grade, OSA's another. */
function fillFile(withOsa: boolean): void {
  db.exec('DELETE FROM players_scouted_ratings');
  const ids = (db.prepare('SELECT player_id AS id FROM players_batting').all() as Array<{ id: number }>).map((r) => r.id);
  for (const id of ids) {
    scoutRow(id, OURS, OUR_GRADE);
    if (withOsa) scoutRow(id, OSA, OSA_GRADE);
  }
  clearFieldingPopulationCache();
}

describe('league yardsticks and fits on OSA\'s view (D-068)', () => {
  beforeAll(() => {
    ratingColumns = [...new Set(['players_batting', 'players_pitching', 'players_fielding'].flatMap(columnsOf).filter((c) => RATING.test(c)))];
    db.exec('DROP TABLE IF EXISTS players_scouted_ratings');
    db.exec(`CREATE TABLE players_scouted_ratings (player_id INTEGER, position INTEGER, scouting_team_id INTEGER, ${ratingColumns.map((c) => `${c} INTEGER`).join(', ')})`);
    setExportRatingMode('osa');
    fillFile(true);
  });
  afterAll(() => {
    db.exec('DROP TABLE IF EXISTS players_scouted_ratings');
    setExportRatingMode(null);
    clearFieldingPopulationCache();
  });

  it('builds a league population on OSA\'s view and judges the player on our scouts\'', () => {
    expect(LEAGUE_POPULATION_SOURCE).toBe('osa');
    expect(populationSource().id).toBe('osa_file');
    expect(loadScoutedAbilities([PLAYER]).for(PLAYER).currentTools.contact).toBe(OUR_GRADE);
    const yardstick = inPopulationView(() => loadScoutedAbilities([PLAYER]).for(PLAYER));
    expect(yardstick.currentTools.contact).toBe(OSA_GRADE);
    expect(yardstick.ratingsFrom).toBe('league_osa');
    // Inside a yardstick nothing is a fill: no "our scouts haven't rated him"
    expect(inPopulationView(() => ratingFillOf(PLAYER))).toBeNull();
  });

  it('says both readings in a league comparison where they differ', () => {
    expect(bothReadings(65, 70)).toBe('Our scouts: 65 · OSA: 70');
    expect(bothReadings(65, 65.2)).toBeNull();
    expect(bothReadings(null, 70)).toBeNull();
    const fit = evaluateDestinationFit(PLAYER, IDS.mlbTeam);
    expect(fit).not.toBeNull();
    expect(fit!.notes.join(' ')).toContain(`Our scouts: ${OUR_GRADE} · OSA: ${OSA_GRADE}`);
    expect(fit!.notes.join(' ')).toMatch(/OSA's view/);
  });

  it('reads the main tables when the export carries no OSA view, labelled', () => {
    fillFile(false);
    try {
      expect(populationSource().id).toBe('export:osa');
      const main = (db.prepare('SELECT batting_ratings_overall_contact AS c FROM players_batting WHERE player_id = ?').get(PLAYER) as { c: number }).c;
      expect(inPopulationView(() => loadScoutedAbilities([PLAYER]).for(PLAYER)).currentTools.contact).toBe(main);
      expect(populationSource().text).toMatch(/no OSA view/);
    } finally {
      fillFile(true);
    }
  });

  it('keeps OSA\'s history in its own snapshots, and a fit reads only those', async () => {
    const outcome = await takeImportSnapshots({
      importFinishedAt: null, importStartedAt: '2040-07-01T12:00:00.000Z',
      ratingMode: { mode: 'osa', additionalScouted: true, source: 'export_settings', reason: null },
    }, async () => {});
    const date = outcome.ratings!.gameDate;
    try {
      const row = historyDb.prepare('SELECT con, kind FROM save_population_snapshots WHERE save_key = ? AND game_date = ? AND player_id = ?')
        .get(currentHistoryKey(), date, PLAYER) as { con: number; kind: string };
      expect(row).toEqual({ con: OSA_GRADE, kind: 'osa_file' });
      const ours = historyDb.prepare('SELECT con FROM save_rating_snapshots WHERE save_key = ? AND game_date = ? AND player_id = ?')
        .get(currentHistoryKey(), date, PLAYER) as { con: number };
      expect(ours.con).toBe(OUR_GRADE);
      const inFit = inPopulationView(() => loadScoutedObservations([PLAYER]).get(PLAYER) ?? []);
      expect(inFit.map((o) => o.ability.currentTools.contact)).toEqual([OSA_GRADE]);
      const judged = loadScoutedObservations([PLAYER]).get(PLAYER) ?? [];
      expect(judged.some((o) => o.ability.currentTools.contact === OUR_GRADE)).toBe(true);
    } finally {
      historyDb.prepare('DELETE FROM save_population_snapshots WHERE save_key = ? AND game_date = ?').run(currentHistoryKey(), date);
      historyDb.prepare('DELETE FROM save_rating_snapshots WHERE save_key = ? AND game_date = ?').run(currentHistoryKey(), date);
      historyDb.prepare('DELETE FROM save_rating_snapshot_modes WHERE save_key = ? AND game_date = ?').run(currentHistoryKey(), date);
    }
  });

  it('records a fit\'s ratings source, refits when it changes, and never treats a fit of another source as its predecessor', () => {
    const seen: Array<{ grade: number | null | undefined; predecessor: string | null }> = [];
    registerCalibration({
      subsystem: 'test', component: 'population-source', method: 'test-v1', trigger: 'each_import', readsRatings: true,
      compute: (basis) => {
        const before = adoptedCalibration<{ grade: number }>(basis.leagueId, 'test', 'population-source', 'test-v1');
        seen.push({ grade: loadScoutedAbilities([PLAYER]).for(PLAYER).currentTools.contact, predecessor: before?.record.ratingSource ?? null });
        return {
          model: { grade: loadScoutedAbilities([PLAYER]).for(PLAYER).currentTools.contact },
          record: {
            leagueId: basis.leagueId, subsystem: 'test', component: 'population-source', method: 'test-v1',
            basis: { throughSeason: null, gameDate: basis.gameDate }, window: { seasons: [], skipped: [], sample: 1, unit: 'players' },
            heldOut: [], priorWeight: { overall: 0, byPart: {} }, gate: { passed: true, reason: 'test', failures: [] }, priorSource: 'none', notes: [],
          },
        };
      },
    });
    const run = () => computeCalibrationRefits({ components: ['population-source'], leagues: [IDS.league] });
    try {
      const first = run();
      expect(first).toHaveLength(1);
      expect(first[0].run?.record.ratingSource).toBe('osa_file');
      expect(first[0].run?.record.notes.join(' ')).toMatch(/Ratings: .*OSA's view/);
      expect(seen[0].grade).toBe(OSA_GRADE);
      recordCalibrationRefits(first);
      // The same source again: already measured
      expect(run()[0].outcome.refit).toBe(false);

      // The export stops carrying OSA's view: refitted on the main tables, recorded as a change, the OSA fit not its predecessor
      fillFile(false);
      const second = run();
      expect(second[0].outcome.refit).toBe(true);
      expect(second[0].force).toBe(true);
      expect(second[0].run?.record.ratingSource).toBe('export:osa');
      expect(second[0].run?.record.notes.join(' ')).toMatch(/source changed \(from osa_file to export:osa\)/);
      expect(seen[seen.length - 1].predecessor).toBeNull();
      // Comparing a policy: under 'evidence' the same fit reads our scouts' grade
      fillFile(true);
      withPopulationPolicy('evidence', () => {
        expect(populationSource().id).toBe('evidence:scouted-complete');
        expect(inPopulationView(() => loadScoutedAbilities([PLAYER]).for(PLAYER)).currentTools.contact).toBe(OUR_GRADE);
      });
    } finally {
      historyDb.prepare(`DELETE FROM save_calibration_fits WHERE subsystem = 'test' AND component = 'population-source'`).run();
      fillFile(true);
    }
  });
});
