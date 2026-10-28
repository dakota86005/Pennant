import { afterEach, describe, expect, it } from 'vitest';
import { historyDb } from '../server/history';
import { recordCalibration, type CalibrationRecord } from '../server/saveCalibrationStore';
import { populationSource } from '../server/scoutedEvidence';
import { clearRosterReviewCalibrationCache, rosterReviewCalibration } from '../server/mlbCalibration';
import { DEFENSE_METHOD, fitDefense, measureStandards, STANDARDS_METHOD, type DefenseSeason, type StandardHolder, type StandardsSample } from '../server/mlbCalibrationFit';
import { DEFENSE_WEIGHT } from '../server/roleReview';
import { STARTING_STANDARDS, standardsFrom } from '../server/roleStandards';

/*
 * Only what Pennant measured in this save is labelled the league's own (D-053; B-67).
 *
 * - A role the save's standards measurement had no holders for was filled with the starting value inside a set stamped "save", and
 *   every role took the set's stamp: "For closers in this league the typical ... is about 71" was the prior's 71 (deep hunt SRVMLB-11).
 * - Glove weights were adopted, and served as the league's own, when they were only no worse than the starting weights on the season
 *   after; every other tuning value with a rival needs the detector's "clearly better" (deep hunt SRVMLB-10; the owner's decision of
 *   2026-10-28: under the detector, like aging, no exemption).
 */

const L = 100;
const rec = (component: string, method: string, passed: boolean, basis: Partial<CalibrationRecord['basis']> = {}): CalibrationRecord => ({
  leagueId: L, subsystem: 'mlb_operations', component, method, ratingSource: populationSource().id,
  basis: { throughSeason: basis.throughSeason ?? null, gameDate: basis.gameDate ?? null },
  window: { seasons: [2016, 2017, 2018], skipped: [], sample: 700, unit: 'pairs' },
  heldOut: [], priorWeight: { overall: 0.4, byPart: {} },
  gate: { passed, reason: passed ? 'Every check passed.' : 'Not adopted.', failures: [] }, priorSource: 'test', notes: [],
});

function rng(seed: number) {
  let s = seed >>> 0;
  const u = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return (s + 0.5) / 4294967296; };
  return { normal: (m = 0, sd = 1) => m + sd * Math.sqrt(-2 * Math.log(u())) * Math.cos(2 * Math.PI * u()) };
}
const clamp = (x: number) => Math.max(0, Math.min(100, x));

/** Thirty clubs with every lineup role, a rotation and a bullpen of every tier but the unknown one (a role nobody holds). */
function league(): StandardsSample {
  const r = rng(1);
  return {
    clubs: Array.from({ length: 30 }, (_, c) => {
      const holders: StandardHolder[] = [];
      for (const [role, t] of [['pos2', 57], ['pos3', 77], ['pos4', 51], ['pos5', 49], ['pos6', 57], ['pos7', 68], ['pos8', 50], ['pos9', 62], ['pos10', 73]] as Array<[string, number]>) {
        const e = clamp(r.normal(t, 15));
        holders.push({ role, estimate: e, bat: clamp(e + r.normal(5, 5)), tools: clamp(r.normal(e, 10)), results: clamp(r.normal(e, 20)) });
      }
      for (let i = 0; i < 5; i += 1) { const e = clamp(r.normal(53, 15)); holders.push({ role: 'starter', estimate: e, bat: null, tools: e, results: e }); }
      for (const [tier, t] of [['closer', 66], ['middle', 51], ['middle', 51], ['long', 37], ['high_leverage', 63], ['low_leverage', 49]] as Array<[string, number]>) {
        const e = clamp(r.normal(t, 13)); holders.push({ role: `rel:${tier}`, estimate: e, bat: null, tools: e, results: e });
      }
      return { clubId: c + 1, gamesPlayed: 40, holders };
    }),
  };
}

afterEach(() => {
  historyDb.exec(`DELETE FROM save_calibration_fits`);
  clearRosterReviewCalibrationCache();
});

describe('a role the save did not measure is the starting yardstick, never the league\'s own (SRVMLB-11)', () => {
  it('the measurement marks a role it had no holders for, and the served standard says "starting"', () => {
    const run = measureStandards(league(), [], { leagueId: L, throughSeason: 2025, gameDate: '2026-05-16' });
    const served = run.model!.served;
    expect(served.source).toBe('save');
    expect(served.roles['rel:unknown'].source).toBe('starting');
    const set = standardsFrom(served);
    expect(set.reliever('unknown').source).toBe('starting');
    expect(set.reliever('unknown').typical).toBe(STARTING_STANDARDS.roles['rel:unknown'].typical);
    expect(set.reliever('closer').source).toBe('save');
    expect(set.starter().source).toBe('save');
  });

  it('a measurement stored before the mark: a role absent from what it measured is read as the starting value', () => {
    const served = { ...STARTING_STANDARDS, source: 'save' as const, roles: { ...STARTING_STANDARDS.roles, starter: { typical: 55 } } };
    recordCalibration({ model: { served, roles: { starter: { n: 150, weight: 0.8, typical: 55, bat: null, tools: null, results: null } } }, record: rec('standards', STANDARDS_METHOD, true, { gameDate: '2000-01-02' }) }, { fitMs: 1 });
    const set = rosterReviewCalibration(L).standards;
    expect(set.starter().source).toBe('save');
    expect(set.reliever('closer').source).toBe('starting');
    expect(set.reliever('closer').typical).toBe(71);
  });
});

describe('glove weights serve as the league\'s own only when clearly better (SRVMLB-10)', () => {
  function fielding(seed: number, seasons: number): DefenseSeason[] {
    const r = rng(seed);
    const players = Array.from({ length: 8 * 60 }, (_, i) => ({ id: i, pos: 2 + (i % 8), def: r.normal(0, 10), bat: r.normal(0, 10) }));
    return Array.from({ length: seasons }, (_, s) => ({
      season: 2030 + s,
      lines: players.map((p) => ({ playerId: p.id, position: p.pos, pa: 550, innings: 1200, batRuns600: p.bat + r.normal(0, 8), fieldRuns1300: p.def + r.normal(0, 6) })),
    }));
  }

  it('a fit no worse than the starting weights, but not judged clearly better, serves the starting weights', () => {
    const run = fitDefense(fielding(8, 3), { leagueId: L, throughSeason: 2032, gameDate: null });
    // "No worse" on the season after: the sanity checks pass...
    expect(run.record.gate.passed).toBe(true);
    // ...but one held-out season can't show "clearly better": the starting weights serve, and the reason says so
    expect(run.model!.serve).toBe('starting');
    expect(run.model!.weights).toEqual({ ...DEFENSE_WEIGHT, 10: 0 });
    expect(run.record.gate.reason).toMatch(/starting glove weights/);
  });

  it('adopted on that verdict, it is not labelled the league\'s own and the review keeps the starting weights', () => {
    const run = fitDefense(fielding(8, 3), { leagueId: L, throughSeason: 2032, gameDate: null });
    recordCalibration({ model: run.model, record: { ...rec('defense', DEFENSE_METHOD, true, { throughSeason: 1991 }), heldOut: run.record.heldOut } }, { fitMs: 1 });
    const y = rosterReviewCalibration(L);
    expect(y.review.defenseWeights).toBeNull();
    expect(y.groups.find((g) => g.key === 'defense')?.source).toBe('starting');
  });

  it('a fit adopted on the old "no worse" rule (defense-1) is not read: the next refit decides under the detector', () => {
    recordCalibration({ model: { weights: { ...DEFENSE_WEIGHT, 6: 0.6 }, positions: {} }, record: rec('defense', 'defense-1', true, { throughSeason: 1991 }) }, { fitMs: 1 });
    const y = rosterReviewCalibration(L);
    expect(y.review.defenseWeights).toBeNull();
    expect(y.groups.find((g) => g.key === 'defense')?.source).toBe('starting');
  });

  it('weights the detector adopted do serve, as the league\'s own', () => {
    const own = { ...DEFENSE_WEIGHT, 6: 0.6 };
    recordCalibration({ model: { weights: own, positions: {}, fitted: own, serve: 'save' }, record: rec('defense', DEFENSE_METHOD, true, { throughSeason: 1991 }) }, { fitMs: 1 });
    const y = rosterReviewCalibration(L);
    expect(y.review.defenseWeights).toEqual(own);
    expect(y.groups.find((g) => g.key === 'defense')?.source).toBe('save');
  });
});
