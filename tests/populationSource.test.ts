import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../server/db.js';
import { evaluateDestinationFit } from '../server/destinationFit.js';
import { historyDb } from '../server/history.js';
import { currentHistoryKey } from '../server/historyIdentity.js';
import { takeImportSnapshots } from '../server/importSnapshots.js';
import { computeCalibrationRefits, recordCalibrationRefits, registerCalibration } from '../server/saveCalibration.js';
import { adoptedCalibration, adoptedCalibrationOnSource, recordCalibration, withRatingSource, type CalibrationRecord } from '../server/saveCalibrationStore.js';
import { completedThrough } from '../server/saveIdentity.js';
import { toolsParamsFor } from '../server/toolsCalibration.js';
import { MLB_CALIBRATION_SUBSYSTEM } from '../server/mlbCalibrationFit.js';
import { TOOLS_METHOD } from '../server/mlbToolsFit.js';
import {
  bothReadings,
  clearFieldingPopulationCache,
  evidenceRatingMode,
  inPopulation,
  inPopulationView,
  LEAGUE_POPULATION_SOURCE,
  loadScoutedAbilities,
  loadScoutedObservations,
  populationSource,
  ratingFillOf,
  ratingSource,
  sameRatingSource,
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
function fillFile(withOsa: boolean, withOurs = true): void {
  db.exec('DELETE FROM players_scouted_ratings');
  const ids = (db.prepare('SELECT player_id AS id FROM players_batting').all() as Array<{ id: number }>).map((r) => r.id);
  for (const id of ids) {
    if (withOurs) scoutRow(id, OURS, OUR_GRADE);
    if (withOsa) scoutRow(id, OSA, OSA_GRADE);
  }
  clearFieldingPopulationCache();
}

function createFile(): void {
  db.exec('DROP TABLE IF EXISTS players_scouted_ratings');
  db.exec(`CREATE TABLE players_scouted_ratings (player_id INTEGER, position INTEGER, scouting_team_id INTEGER, ${ratingColumns.map((c) => `${c} INTEGER`).join(', ')})`);
}

/** The export carries no complete-scouted file at all. */
function dropFile(): void {
  db.exec('DROP TABLE IF EXISTS players_scouted_ratings');
  clearFieldingPopulationCache();
}

const mainContact = (): number =>
  (db.prepare('SELECT batting_ratings_overall_contact AS c FROM players_batting WHERE player_id = ?').get(PLAYER) as { c: number }).c;

describe('league yardsticks and fits on OSA\'s view (D-068)', () => {
  beforeAll(() => {
    ratingColumns = [...new Set(['players_batting', 'players_pitching', 'players_fielding'].flatMap(columnsOf).filter((c) => RATING.test(c)))];
    createFile();
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
    // A percentile reads as one, never as a 20-80 grade (review L2)
    expect(bothReadings(65, 70, 'percentile')).toBe('Our scouts: 65th percentile · OSA: 70th');
    expect(bothReadings(21, 3, 'percentile')).toBe('Our scouts: 21st percentile · OSA: 3rd');
    // Plain words: no "yardsticks and fits", and OSA is the league's shared scouting service, nothing claimed of its seasons
    expect(populationSource().text).not.toMatch(/yardstick|fits? read|every season/);
    expect(populationSource().text).toMatch(/shared scouting service/);
    expect(bothReadings(65, 65.2)).toBeNull();
    expect(bothReadings(null, 70)).toBeNull();
    const fit = evaluateDestinationFit(PLAYER, IDS.mlbTeam);
    expect(fit).not.toBeNull();
    expect(fit!.notes.join(' ')).toContain(`Our scouts: ${OUR_GRADE} · OSA: ${OSA_GRADE}`);
    expect(fit!.notes.join(' ')).toMatch(/OSA's view/);
  });

  it('without OSA\'s rows, reads our scouts\' reports, never the main tables (the owner\'s decision, M1), in a "real" export', () => {
    setExportRatingMode('real');
    fillFile(false);
    try {
      expect(populationSource().id).toBe('our_scouts_file');
      expect(populationSource().text).toMatch(/your scouts' full reports/);
      // The main tables are true ratings here: never the yardstick
      expect(mainContact()).not.toBe(OUR_GRADE);
      const yardstick = inPopulationView(() => loadScoutedAbilities([PLAYER]).for(PLAYER));
      expect(yardstick.currentTools.contact).toBe(OUR_GRADE);
      expect(yardstick.ratingsFrom).toBe('our_scouts');
    } finally {
      setExportRatingMode('osa');
      fillFile(true);
    }
  });

  it('never shows true ratings labelled "OSA": no second reading without OSA\'s rows (review H1)', () => {
    setExportRatingMode('real');
    fillFile(false);
    try {
      expect(bothReadings(65, 70)).toBeNull();
      const fit = evaluateDestinationFit(PLAYER, IDS.mlbTeam);
      expect(fit).not.toBeNull();
      expect(fit!.notes.join(' ')).not.toMatch(/OSA:/);
      expect(fit!.notes.join(' ')).not.toMatch(/OSA's view/);
    } finally {
      setExportRatingMode('osa');
      fillFile(true);
    }
  });

  it('reads the main tables only when the export carries no complete-scouted file, labelled', () => {
    dropFile();
    try {
      expect(populationSource().id).toBe('export:osa');
      expect(inPopulationView(() => loadScoutedAbilities([PLAYER]).for(PLAYER)).currentTools.contact).toBe(mainContact());
      expect(populationSource().text).toMatch(/no OSA view/);
      expect(bothReadings(65, 70)).toBeNull();
    } finally {
      createFile();
      fillFile(true);
    }
  });

  it('reads OSA\'s view, said so, in place of true ratings when no row of ours can be read (review L6)', async () => {
    setExportRatingMode('real');
    fillFile(true, false);
    try {
      expect(evidenceRatingMode()).toBe('osa');
      expect(ratingSource().short).toBe('OSA\'s view');
      expect(ratingSource().text).toMatch(/main ratings are true ratings/);
      const judged = loadScoutedAbilities([PLAYER]).for(PLAYER);
      expect(judged.currentTools.contact).toBe(OSA_GRADE);
      expect(judged.ratingsFrom).toBe('osa_view');
      // Said for the whole export, not marked per player
      expect(ratingFillOf(PLAYER)).toBeNull();
      // The viewer unresolved: our rows are there but can't be told apart, so OSA's view, and the sentence says why
      fillFile(true, true);
      db.prepare('UPDATE teams SET human_team = 0 WHERE team_id = ?').run(OURS);
      clearFieldingPopulationCache();
      expect(loadScoutedAbilities([PLAYER]).for(PLAYER).currentTools.contact).toBe(OSA_GRADE);
      expect(ratingSource().text).toMatch(/couldn't tell which club is yours/);
      // Its snapshot is stamped as OSA's kind, never compared with true ratings
      const outcome = await takeImportSnapshots({
        importFinishedAt: null, importStartedAt: '2040-07-02T12:00:00.000Z',
        ratingMode: { mode: 'real', additionalScouted: true, source: 'export_settings', reason: null },
      }, async () => {});
      const date = outcome.ratings!.gameDate;
      try {
        const stamp = historyDb.prepare('SELECT mode FROM save_rating_snapshot_modes WHERE save_key = ? AND game_date = ?').get(currentHistoryKey(), date) as { mode: string };
        expect(stamp.mode).toBe('osa');
      } finally {
        for (const t of ['save_population_snapshots', 'save_rating_snapshots', 'save_rating_snapshot_modes']) {
          historyDb.prepare(`DELETE FROM ${t} WHERE save_key = ? AND game_date = ?`).run(currentHistoryKey(), date);
        }
      }
    } finally {
      db.prepare('UPDATE teams SET human_team = 1 WHERE team_id = ?').run(OURS);
      setExportRatingMode('osa');
      fillFile(true);
    }
  });

  it('refuses a scope that would stay open across an await (review L4)', () => {
    expect(() => inPopulationView(() => Promise.resolve(1))).toThrow(/synchronous code only/);
    expect(inPopulation()).toBe(false);
    expect(() => withRatingSource({ subsystem: 'test', component: 'x', source: 'osa_file' }, () => Promise.resolve(1))).toThrow(/synchronous code only/);
    // The source scope closed: another component's fit is read as usual
    expect(() => withPopulationPolicy('evidence', () => Promise.resolve(1))).toThrow(/synchronous code only/);
    expect(populationSource().id).toBe('osa_file');
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

      // The export stops carrying OSA's view: refitted on our scouts' reports, recorded as a change, the OSA fit not its predecessor
      fillFile(false);
      const second = run();
      expect(second[0].outcome.refit).toBe(true);
      expect(second[0].force).toBe(true);
      expect(second[0].run?.record.ratingSource).toBe('our_scouts_file');
      expect(second[0].run?.record.notes.join(' ')).toMatch(/source changed \(from osa_file to our_scouts_file\)/);
      expect(seen[seen.length - 1].grade).toBe(OUR_GRADE);
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

describe('a fit after a change of ratings source (D-068, the owner\'s decision M2)', () => {
  let pass = true;
  let computed = 0;
  const COMPONENT = 'source-switch';
  const recordOf = (leagueId: number, gameDate: string | null, passed: boolean): CalibrationRecord => ({
    leagueId, subsystem: 'test', component: COMPONENT, method: 'test-v1',
    basis: { throughSeason: null, gameDate }, window: { seasons: [], skipped: [], sample: 1, unit: 'players' },
    heldOut: [], priorWeight: { overall: 0, byPart: {} }, gate: { passed, reason: passed ? 'held up' : 'did not hold up', failures: passed ? [] : ['x'] },
    priorSource: 'none', notes: [],
  });
  const run = () => computeCalibrationRefits({ components: [COMPONENT], leagues: [IDS.league] });
  const served = () => adoptedCalibrationOnSource(IDS.league, 'test', COMPONENT, 'test-v1', {}, populationSource().id);
  const clearFits = () => {
    historyDb.prepare(`DELETE FROM save_calibration_fits WHERE subsystem IN ('test', ?)`).run(MLB_CALIBRATION_SUBSYSTEM);
    historyDb.prepare(`DELETE FROM save_calibration_source_attempts WHERE subsystem = 'test'`).run();
  };

  beforeAll(() => {
    ratingColumns = [...new Set(['players_batting', 'players_pitching', 'players_fielding'].flatMap(columnsOf).filter((c) => RATING.test(c)))];
    registerCalibration({
      subsystem: 'test', component: COMPONENT, method: 'test-v1', trigger: 'each_import', readsRatings: true,
      compute: (basis) => {
        computed += 1;
        return { model: { grade: loadScoutedAbilities([PLAYER]).for(PLAYER).currentTools.contact }, record: recordOf(basis.leagueId, basis.gameDate, pass) };
      },
    });
  });
  afterAll(() => {
    clearFits();
    db.exec('DROP TABLE IF EXISTS players_scouted_ratings');
    setExportRatingMode(null);
    clearFieldingPopulationCache();
  });

  it('serves the labelled starting estimate when the refit on the new source fails, and does not rerun it', () => {
    clearFits();
    // A "real ratings" export with no complete-scouted file: the fit rests on true ratings
    dropFile();
    setExportRatingMode('real');
    pass = true;
    recordCalibrationRefits(run());
    expect(served().fit?.record.ratingSource).toBe('export:real');

    // The next export carries the file with OSA's rows: the source changes to OSA's view and the refit fails its gate
    createFile();
    fillFile(true);
    expect(populationSource().id).toBe('osa_file');
    pass = false;
    const before = computed;
    const tried = run();
    expect(tried[0].outcome.refit).toBe(true);
    expect(tried[0].force).toBe(true);
    recordCalibrationRefits(tried);
    expect(computed).toBe(before + 1);
    // The earlier fit is on true ratings: not served, and the basis says so
    const now = served();
    expect(now.fit).toBeNull();
    expect(now.setAside?.text).toMatch(/earlier fit rests on true ratings, not today's ratings \(OSA's view\), so it isn't used/);
    // The same export again (a re-import, a start-up): not rerun
    const again = run();
    expect(again[0].outcome.refit).toBe(false);
    expect(again[0].outcome.reason).toMatch(/Already tried on osa_file/);
    expect(computed).toBe(before + 1);
    // The gate still governs: a passing refit (forced, as a developer's harness does) is adopted and served
    pass = true;
    recordCalibrationRefits(computeCalibrationRefits({ components: [COMPONENT], leagues: [IDS.league], force: true }));
    expect(served().fit?.record.ratingSource).toBe('osa_file');
  });

  it('a real serving reader (the tools fit) serves the starting values, labelled, when its fit is on other ratings', () => {
    clearFits();
    dropFile();
    setExportRatingMode('real');
    const through = completedThrough(IDS.league).season;
    const model = { bat: { source: 'save', served: [0.002, 0.0004, 0.0013, 0.0009, 0.0001] }, blend: { source: 'starting', served: 1 } };
    const record = { ...recordOf(IDS.league, null, true), subsystem: MLB_CALIBRATION_SUBSYSTEM, component: 'tools', method: TOOLS_METHOD, basis: { throughSeason: through, gameDate: null }, ratingSource: 'export:real' };
    recordCalibration({ model, record }, { fitMs: 1 });
    expect(toolsParamsFor(IDS.league).source).toBe('save');
    createFile();
    fillFile(true);
    const params = toolsParamsFor(IDS.league);
    expect(params.source).toBe('starting');
    expect(params.stamp.basis).toMatch(/rests on true ratings, not today's ratings \(OSA's view\), so it isn't used/);
  });

  it('keeps its fit across a switch from OSA in the main tables to OSA\'s rows in the file', () => {
    clearFits();
    expect(sameRatingSource('export:osa', 'osa_file')).toBe(true);
    expect(sameRatingSource(null, 'osa_file')).toBe(false);
    dropFile();
    setExportRatingMode('osa');
    pass = true;
    recordCalibrationRefits(run());
    expect(served().fit?.record.ratingSource).toBe('export:osa');
    createFile();
    fillFile(true);
    expect(populationSource().id).toBe('osa_file');
    pass = false;
    const again = run();
    expect(again[0].outcome.refit).toBe(false);
    expect(again[0].outcome.reason).toMatch(/Already measured/);
    expect(served().fit?.record.ratingSource).toBe('export:osa');
  });
});
