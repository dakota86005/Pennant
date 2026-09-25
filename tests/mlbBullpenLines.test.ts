import { describe, expect, it } from 'vitest';
import { historyDb } from '../server/history';
import { recordCalibration, type CalibrationRecord } from '../server/saveCalibrationStore';
import { clearRosterReviewCalibrationCache, rosterReviewCalibration } from '../server/mlbCalibration';
import { measureLongLine, LONG_LINE_POLICY, type RelieverUsage } from '../server/mlbBullpenLines';
import { measureStandards, rekeyRelievers, STANDARDS_METHOD, STANDARDS_METHOD_BEFORE_LINES, type StandardsSample } from '../server/mlbCalibrationFit';
import { BULLPEN_PRIOR, LEVERAGE, LONG_LINE_PRIOR, MULTI_INNING, roleOf, type BullpenUsage } from '../server/bullpenRoles';
import { relieverKey, STARTING_STANDARDS } from '../server/roleStandards';

/*
 * A long man is judged against how this league's relievers are used (D-053, cycle 3). The long-man line is a measurement of the league as
 * it stands (the innings per appearance of its longest-working sixth of relievers), served only when it holds up on clubs, and on the
 * part of the season, it was not drawn from; it is in force together with the reliever standards measured under it.
 */

function rng(seed: number) {
  let s = seed >>> 0;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return (s + 0.5) / 4294967296; };
}

/** 30 clubs of 8 relievers whose innings per appearance centre on `centre` (sd about 0.35), 20 appearances each, split evenly by half. */
function pens(centre: number, seed = 7, withHalves = true, clubs = 30): RelieverUsage[] {
  const u = rng(seed);
  const out: RelieverUsage[] = [];
  for (let c = 0; c < clubs; c += 1) {
    for (let i = 0; i < 8; i += 1) {
      const ipa = Math.max(0.5, centre + 0.35 * Math.sqrt(-2 * Math.log(u())) * Math.cos(2 * Math.PI * u()));
      const g = 20;
      const wobble = 1 + 0.08 * (u() - 0.5);
      out.push({ playerId: c * 100 + i, clubId: c, g, ip: ipa * g, halves: withHalves ? { first: { g: 10, ip: 10 * ipa * wobble }, second: { g: 10, ip: 10 * ipa * (2 - wobble) } } : null });
    }
  }
  return out;
}

describe('the long-man line is the league\'s own', () => {
  it('a league whose relievers work longer draws its long-man line higher, and it holds up on clubs and on the season it was not drawn from', () => {
    const m = measureLongLine(pens(1.3), 1.02);
    expect(m.passed).toBe(true);
    expect(m.lines.source).toBe('save');
    expect(m.lines.long).toBeGreaterThan(LONG_LINE_PRIOR);
    const share = m.checks.find((c) => c.kind === 'club_split')!;
    expect(Math.abs((share.observed as number) - (1 - LONG_LINE_POLICY.quantile))).toBeLessThanOrEqual(LONG_LINE_POLICY.tolerance);
    expect(m.checks.find((c) => c.kind === 'season_split')!.passed).toBe(true);
  });

  it('it is never below what "multiple innings" means: a league of one-inning relievers keeps long men for those who throw more', () => {
    const m = measureLongLine(pens(0.8), 1.0);
    expect(m.lines.long).toBeGreaterThanOrEqual(MULTI_INNING);
  });

  it('too few relievers to measure keeps the starting line and says why', () => {
    const m = measureLongLine(pens(1.3, 7, true, 10), 1.0);
    expect(m.passed).toBe(false);
    expect(m.reason).toBe('relievers');
    expect(m.lines.long).toBe(LONG_LINE_PRIOR);
    expect(m.lines.source).toBe('starting');
  });

  it('a line that does not hold up on the second half of the season is not served', () => {
    // the first half's relievers worked far longer than the second's: a line drawn on one half does not describe the other
    const usage = pens(1.3).map((r) => ({ ...r, halves: { first: { g: 10, ip: (r.ip / r.g) * 10 * 1.6 }, second: { g: 10, ip: (r.ip / r.g) * 10 * 0.6 } } }));
    const m = measureLongLine(usage, 1.0);
    expect(m.checks.find((c) => c.kind === 'season_split')!.passed).toBe(false);
    expect(m.passed).toBe(false);
    expect(m.reason).toBe('check_failed');
    expect(m.lines.long).toBe(LONG_LINE_PRIOR);
  });

  it('without game logs the season split is not measured, and not required', () => {
    const m = measureLongLine(pens(1.3, 7, false), 1.0);
    expect(m.checks.find((c) => c.kind === 'season_split')!.passed).toBeNull();
    expect(m.passed).toBe(true);
  });

  it('the leverage lines are on the league\'s own scale: a season\'s wobble moves nothing, a league off the scale is rescaled', () => {
    expect(measureLongLine(pens(1.3), 1.0225).lines.leverage).toEqual({ ...LEVERAGE });
    const off = measureLongLine(pens(1.3), 1.2).lines;
    expect(off.rescaled).toBe(true);
    expect(off.leverage.closer).toBeCloseTo(1.92, 6);
    // rescaled even when the long line itself is not measured
    expect(measureLongLine(pens(1.3, 7, true, 10), 1.2).lines.rescaled).toBe(true);
  });
});

describe('the reliever standards are measured under the same line they are served with', () => {
  const usage = (ipa: number, lev = 0.8): BullpenUsage => ({ playerId: 1, name: 'R', g: 20, ip: 20 * ipa, sv: 0, hld: 0, leverage: lev });

  it('re-reading a reliever under a higher long-man line moves him from long man to low-leverage arm, and nobody else moves', () => {
    const sample: StandardsSample = { clubs: [{ clubId: 1, gamesPlayed: 40, holders: [
      { role: relieverKey('long'), estimate: 20, bat: null, tools: 20, results: 20, usage: usage(1.65) },
      { role: relieverKey('closer'), estimate: 70, bat: null, tools: 70, results: 70, usage: { ...usage(1.0, 2.0), sv: 10 } },
      { role: 'pos3', estimate: 60, bat: 60, tools: 60, results: 60 },
    ] }] };
    const moved = rekeyRelievers(sample, { ...BULLPEN_PRIOR, long: 1.7, source: 'save' });
    expect(moved.clubs[0].holders.map((h) => h.role)).toEqual([relieverKey('low_leverage'), relieverKey('closer'), 'pos3']);
    expect(rekeyRelievers(sample, BULLPEN_PRIOR).clubs[0].holders.map((h) => h.role)).toEqual(sample.clubs[0].holders.map((h) => h.role));
    expect(roleOf(usage(1.65), BULLPEN_PRIOR).tier).toBe('long');
  });

  it('the standards record the lines they were measured under; the line\'s checks never decide whether the standards are adopted', () => {
    const m = measureLongLine(pens(1.3, 7, true, 10), 1.0); // too few relievers: the line is not measured
    const run = measureStandards({ clubs: [] }, [], { leagueId: 1, throughSeason: 2025, gameDate: '2026-5-1' }, undefined, undefined, [], m);
    expect(run.record.method).toBe(STANDARDS_METHOD);
    expect(run.record.gate.failures[0]).toBe('clubs');
  });
});

describe('the lines in force are the ones the standards in force were measured under', () => {
  const L = 100;
  const rec = (method: string, passed: boolean, date: string, failures: string[] = []): CalibrationRecord => ({
    leagueId: L, subsystem: 'mlb_operations', component: 'standards', method, basis: { throughSeason: null, gameDate: date },
    window: { seasons: [], skipped: [], sample: 600, unit: 'holders' },
    heldOut: [{ kind: 'club_split', part: 'long_line', n: 110, expected: 0.15, observed: 0.17, passed: true }],
    priorWeight: { overall: 0.2, byPart: { long_line: 0.22 } }, gate: { passed, reason: passed ? 'ok' : 'no', failures }, priorSource: 'test', notes: [],
  });
  const lines = { ...BULLPEN_PRIOR, long: 1.7, source: 'save' as const, leagueLeverage: 1.02 };
  const model = (withLines: boolean) => ({ served: { ...STARTING_STANDARDS, source: 'save' }, roles: {}, ...(withLines ? { bullpen: { lines, measured: 1.73, asServed: 1.7, relievers: 219, passed: true, reason: null } } : {}) });
  const inForce = (setup: Array<() => void>) => {
    historyDb.exec('DELETE FROM save_calibration_fits');
    for (const s of setup) s();
    clearRosterReviewCalibrationCache();
    const y = rosterReviewCalibration(L);
    historyDb.exec('DELETE FROM save_calibration_fits');
    clearRosterReviewCalibrationCache();
    return y;
  };

  it('a standards measurement from before the line was measured is read as measured under the starting line', () => {
    const y = inForce([() => recordCalibration({ model: model(false), record: rec(STANDARDS_METHOD_BEFORE_LINES, true, '2000-01-02') }, { fitMs: 1 })]);
    expect(y.standards.source).toBe('save');
    expect(y.bullpen).toEqual(BULLPEN_PRIOR);
    const g = y.groups.find((x) => x.key === 'bullpen')!;
    expect(g.source).toBe('starting');
    expect(g.reason).toBe('not_measured');
  });

  it('a standards measurement with its line serves the two together', () => {
    const y = inForce([() => recordCalibration({ model: model(true), record: rec(STANDARDS_METHOD, true, '2000-01-02') }, { fitMs: 1 })]);
    expect(y.bullpen.long).toBe(1.7);
    const g = y.groups.find((x) => x.key === 'bullpen')!;
    expect(g.source).toBe('save');
    expect(g.text).toMatch(/1\.7 or more innings an appearance/);
  });

  it('a new measurement that does not pass leaves the old standards and their old line in force, never one line for the tiers and another for the standards', () => {
    const y = inForce([
      () => recordCalibration({ model: model(false), record: rec(STANDARDS_METHOD_BEFORE_LINES, true, '2000-01-02') }, { fitMs: 1 }),
      () => recordCalibration({ model: null, record: rec(STANDARDS_METHOD, false, '2000-01-03', ['games']) }, { fitMs: 1 }),
    ]);
    expect(y.standards.source).toBe('save');
    expect(y.bullpen).toEqual(BULLPEN_PRIOR);
    expect(y.groups.find((x) => x.key === 'bullpen')!.reason).toBe('games');
  });
});
