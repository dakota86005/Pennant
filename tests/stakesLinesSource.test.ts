import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { CEILING_LINES, startingLines, type CeilingLinesInForce } from '../server/developmentFit.js';
import { historyDb } from '../server/history.js';
import { populationSource } from '../server/scoutedEvidence.js';
import { latestCalibrationAttempt, recordCalibration } from '../server/saveCalibrationStore.js';
import { measureCeilingLines, STAKES_LINES_COMPONENT, STAKES_LINES_METHOD, STAKES_SUBSYSTEM, stakesLinesFor, type MajorLeaguer, type StakesLinesModel } from '../server/stakesLines.js';
import { computeStakesLines } from '../server/stakesLinesRefit.js';
import { db } from '../server/db.js';
import { IDS } from './fixture.js';

/*
 * D-068 (the owner's decision): lines measured on other ratings are never served as this save's, and a failed or thin refit after a
 * change of source serves the starting lines, labelled. The lines "in force before" a measurement read the latest attempt of ANY
 * source, so a thin measurement on today's ratings carried lines measured on true ratings, recorded them as the league's own, and
 * `stakesLinesFor` served them (B-67, deep hunt SRVDEV-02).
 */

let seed = 7;
const rnd = () => ((seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 4294967296);
function league(clubs: number, per: number, centre: { hitter: number; pitcher: number }): MajorLeaguer[] {
  seed = 11;
  const out: MajorLeaguer[] = [];
  for (let c = 1; c <= clubs; c += 1) {
    for (const kind of ['hitter', 'pitcher'] as const) {
      for (let i = 0; i < per; i += 1) {
        const z = Math.sqrt(-2 * Math.log(Math.max(1e-9, rnd()))) * Math.cos(2 * Math.PI * rnd());
        out.push({ clubId: c, kind, composite: Math.round(centre[kind] + 4 * z) });
      }
    }
  }
  return out;
}

const START: CeilingLinesInForce = startingLines('not_measured');
const clear = () => historyDb.prepare('DELETE FROM save_calibration_fits WHERE subsystem = ?').run(STAKES_SUBSYSTEM);

/** Lines measured and adopted on another ratings source than today's (true ratings), at an earlier export. */
function adoptedOnTrueRatings(gameDate: string) {
  const old = measureCeilingLines(league(30, 13, { hitter: 62, pitcher: 48 }), { leagueId: IDS.league, gameDate, throughSeason: 2029 }, START);
  expect(old.record.gate.passed).toBe(true);
  old.record.ratingSource = 'export:real';
  recordCalibration(old, { fitMs: 1 });
  return old;
}

afterEach(() => clear());
afterAll(() => {
  clear();
  db.prepare('DELETE FROM team_roster WHERE list_id = 2').run();
});

describe('the stakes lines never carry lines measured on other ratings', () => {
  it('a thin measurement on today\'s ratings carries nothing of the true-ratings lines, and the starting lines serve', () => {
    clear();
    const old = adoptedOnTrueRatings('2030-04-01');
    expect(populationSource().id).not.toBe('export:real');
    // The fixture's major-league clubs' active lists: major leaguers to read, too few to measure
    db.prepare('INSERT INTO team_roster (team_id, player_id, list_id) SELECT team_id, player_id, 2 FROM team_roster WHERE list_id = 1 AND team_id IN (?, ?)').run(IDS.mlbTeam, IDS.otherMlbTeam);
    const today = computeStakesLines({ leagueId: IDS.league, gameDate: '2030-05-01', throughSeason: 2029 });
    if ('skip' in today) throw new Error(`skipped: ${today.skip}`);
    expect(today.model.inForce.source).toBe('starting');
    expect(today.model.inForce.lines).not.toEqual(old.model.inForce.lines);
    today.record.ratingSource = populationSource().id; // as the driver records it
    recordCalibration(today, { fitMs: 1 });
    const served = stakesLinesFor(IDS.league);
    expect(served.lines).toEqual(CEILING_LINES);
    expect(served.source).toBe('starting');
  });

  it('an attempt stored before this check, carrying the other source\'s lines under today\'s, is set aside, said so', () => {
    clear();
    const old = adoptedOnTrueRatings('2030-04-01');
    // What the unfiltered carry recorded: today's source on the record, the true-ratings lines in force
    const carried = measureCeilingLines([], { leagueId: IDS.league, gameDate: '2030-05-01', throughSeason: 2029 }, old.model.inForce);
    expect(carried.model.inForce.source).toBe('save');
    carried.record.ratingSource = populationSource().id;
    recordCalibration(carried, { fitMs: 1 });
    const served = stakesLinesFor(IDS.league);
    expect(served.source).toBe('starting');
    expect(served.lines).toEqual(CEILING_LINES);
    expect(served.setAside).toMatch(/true ratings/i);
  });

  it('the latest attempt on a source is the latest ON it, not the latest of any source filtered afterwards', () => {
    clear();
    const ours = measureCeilingLines(league(30, 13, { hitter: 55, pitcher: 45 }), { leagueId: IDS.league, gameDate: '2030-03-01', throughSeason: 2029 }, START);
    ours.record.ratingSource = populationSource().id;
    recordCalibration(ours, { fitMs: 1 });
    adoptedOnTrueRatings('2030-04-01');
    const latest = latestCalibrationAttempt<StakesLinesModel>(IDS.league, STAKES_SUBSYSTEM, STAKES_LINES_COMPONENT, STAKES_LINES_METHOD,
      { gameDateMax: '2030-06-01', ratingSource: populationSource().id });
    expect(latest?.basis).toBe('2030-03-01');
  });
});
